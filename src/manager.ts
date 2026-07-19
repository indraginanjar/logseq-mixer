import { getActivePageContext } from 'blockTreeFormatter';
import { BM25Index } from 'bm25Index';
import { parseEditCommands } from 'editCommandParser';
import { buildEditSystemPrompt, buildPageContextMessage } from 'editPromptBuilder';
import { clearRefCache, useGenerateEmbedding } from 'embedManager';
import { hybridSearch } from 'hybridSearch';
import type { RankedHit } from 'reranker';
import { shouldRetrieveContext } from 'intentClassifier';
import { rewriteQueryForRetrieval } from './queryRewriter';
import { isDiagramIntent, DIAGRAM_RULES } from './utils/diagramIntentDetector';
import { checkAndIndexUpdatedPages, startPageIndexingOnChange, type IndexingResult } from 'indexManager';
import { queryLiteLLM, type ChatMessage, type MessageContentPart, getContextLimitForModel, getMaxTokensForModel } from 'LLMManager';
import { countTokens, encode, decode } from 'tokenizer';
import { SQLiteVectorStore } from './storage/SQLiteVectorStore';
import type { PerDocumentStorageProvider, StorageProvider } from './storage/StorageProvider';
import { MCPManager } from 'mcp/MCPManager';
import type { VectorSearchAccelerator } from './storage/VectorSearchAccelerator';
import type { EditCommand } from './types/editTypes';
import { MemoryStore } from './memory/MemoryStore';
import { detectExplicitMemory } from './memory/memoryDetector';
import { detectGoal } from './agent/goalDetector';
import { runReActLoop } from './agent/ReActLoop';

const CURRENT_CHUNKING_VERSION = '2'; // token-based

// Global variable to store conversation history
const conversationHistory: Array<{ role: 'user' | 'assistant', content: string }> = [];
// Set maximum number of history messages to include in the prompt (e.g., last 6 messages)
const MAX_HISTORY_LENGTH = 6;

export interface EditQueryResult {
  text: string;           // LLM response with json-edit blocks stripped
  commands: EditCommand[]; // parsed edit commands (may be empty)
}

/** A retrieved chunk with its relevance score preserved for filtering. */
interface ScoredChunk {
  content: string;
  rrfScore: number;
}

/** Clear the conversation history for a fresh session. */
export function clearConversationHistory(): void {
  conversationHistory.length = 0;
}

/** Add a message to conversation history (used by agent to persist results for follow-up). */
export function addToConversationHistory(role: 'user' | 'assistant', content: string): void {
  conversationHistory.push({ role, content });
  if (conversationHistory.length > MAX_HISTORY_LENGTH * 2) {
    conversationHistory.splice(0, conversationHistory.length - MAX_HISTORY_LENGTH * 2);
  }
}

/** Module-level BM25 index, lazily initialized on first hybrid search. */
let bm25Index: BM25Index | null = null;

/** Return the current BM25 index (may be null if not yet initialized). */
export function getBM25Index(): BM25Index | null {
  return bm25Index;
}

/** Reset the BM25 index (used when the store is cleared). */
export function resetBM25Index(): void {
  bm25Index = null;
}

/** Module-level accelerator reference, set from outside via setAccelerator(). */
let accelerator: VectorSearchAccelerator | null = null;

/** Set the VectorSearchAccelerator instance for use by handleQuery and indexEntireLogSeq. */
export function setAccelerator(acc: VectorSearchAccelerator | null): void {
  accelerator = acc;
}

/** Return the current VectorSearchAccelerator instance (may be null). */
export function getAccelerator(): VectorSearchAccelerator | null {
  return accelerator;
}

/** Module-level memory store instance. */
let memoryStore: MemoryStore | null = null;
let lastMemorySaved = false;

let onThoughtCallback: ((thought: string, iteration: number) => void) | null = null;
export function setOnThoughtCallback(cb: ((thought: string, iteration: number) => void) | null): void {
  onThoughtCallback = cb;
}

export function setMemoryStore(store: MemoryStore): void {
  memoryStore = store;
}

export function getMemoryStore(): MemoryStore | null {
  return memoryStore;
}

export function getLastMemorySaved(): boolean {
  return lastMemorySaved;
}

/** Pending agent goal detected by handleQuery. */
export let pendingAgentGoal: string | null = null;
export function clearPendingAgentGoal(): void { pendingAgentGoal = null; }

/**
 * Ensure the BM25 index is initialized. If it hasn't been created yet,
 * build it from all document content in the storage provider.
 */
function ensureBM25Index(storageProvider: PerDocumentStorageProvider): BM25Index {
  if (bm25Index === null) {
    bm25Index = new BM25Index();
    try {
      const docs = storageProvider.getAllDocumentContent();
      bm25Index.buildFromDocuments(docs);
      console.info(`[ensureBM25Index] Built BM25 index from ${docs.length} documents`);
    } catch (err) {
      console.warn('[ensureBM25Index] Failed to build BM25 index, starting empty:', err);
    }
  }
  return bm25Index;
}

export async function indexEntireLogSeq(settings: any, storageProvider: StorageProvider): Promise<IndexingResult> {
  clearRefCache();

  if (storageProvider instanceof SQLiteVectorStore) {
    const storedVersion = storageProvider.getChunkingVersion();
    if (storedVersion !== CURRENT_CHUNKING_VERSION) {
      console.info('[indexEntireLogSeq] Chunking version mismatch, forcing full re-index.');
      await storageProvider.clear();
      resetBM25Index();
      storageProvider.setChunkingVersion(CURRENT_CHUNKING_VERSION);
    }
  }

  const result = await checkAndIndexUpdatedPages(settings.apiKey, undefined, settings.EmbeddingApiKey, settings.embeddingModel, storageProvider, settings.embeddingEndpoint, settings.embeddingProvider, accelerator ?? undefined);
  resetBM25Index();
  return result;
}

export async function enableAutoIndexer(settings: any, storageProvider: StorageProvider) {
  startPageIndexingOnChange(settings.apiKey, undefined, settings.EmbeddingApiKey, settings.embeddingModel, storageProvider, settings.embeddingEndpoint, settings.embeddingProvider, accelerator ?? undefined);
}

function truncateToTokens(text: string, maxTokens: number): string {
  if (maxTokens <= 0) return "";
  const tokens = encode(text);
  if (tokens.length <= maxTokens) return text;
  return decode(tokens.slice(0, maxTokens)) + "\n... (truncated to fit model context limit)";
}

async function retrieveVectorContext(query: string, settings: any, storageProvider: StorageProvider): Promise<ScoredChunk[]> {
  try {
    const queryEmbedding = await useGenerateEmbedding(query, settings.EmbeddingApiKey, settings.embeddingModel, settings.embeddingEndpoint, settings.embeddingProvider);
    const provider = storageProvider as PerDocumentStorageProvider;
    if (typeof provider.searchByVector !== 'function') {
      console.warn('[retrieveVectorContext] storageProvider has no searchByVector — returning empty');
      return [];
    }
    const index = ensureBM25Index(provider);
    const reranked = await hybridSearch(query, queryEmbedding, provider, index, { accelerator: accelerator ?? undefined });
    console.info(`[retrieveVectorContext] Query: "${query.slice(0, 80)}..." → ${reranked.length} results`);
    if (reranked.length > 0) {
      reranked.forEach((hit, i) => {
        console.info(`  [${i}] score=${hit.rrfScore.toFixed(4)} id=${hit.id} content="${hit.content.slice(0, 100)}..."`);
      });
    } else {
      console.warn('[retrieveVectorContext] No results from hybrid search! Check if documents are indexed.');
      if ('getDocumentCount' in provider && typeof (provider as any).getDocumentCount === 'function') {
        const docCount = await (provider as any).getDocumentCount();
        console.warn(`[retrieveVectorContext] Document count in store: ${docCount}`);
      }
    }

    // --- Link-aware expansion ---
    const existingIds = new Set(reranked.map(h => h.id));
    const pageRefs = extractPageRefsFromResults(reranked.map(h => h.content), query);
    const queryPageRefs = extractPageNamesFromQuery(query, reranked.map(h => h.content));
    for (const qRef of queryPageRefs) {
      if (!pageRefs.includes(qRef)) {
        pageRefs.push(qRef);
      }
    }

    if (pageRefs.length > 0) {
      console.info(`[retrieveVectorContext] Link-aware expansion: searching for page refs: ${pageRefs.join(', ')}`);
      const expansionHits: RankedHit[] = [];
      for (const pageName of pageRefs) {
        const bm25Results = index.search(pageName, 5);
        for (const hit of bm25Results) {
          if (!existingIds.has(hit.id) && hit.score > 0) {
            existingIds.add(hit.id);
            expansionHits.push({ id: hit.id, content: hit.content, score: 0, rrfScore: hit.score * 0.5, keywordScore: hit.score, vectorRank: 0, keywordRank: 0 });
          }
        }
      }
      if (expansionHits.length > 0) {
        expansionHits.sort((a, b) => b.rrfScore - a.rrfScore);
        const topExpansion = expansionHits.slice(0, 5);
        console.info(`[retrieveVectorContext] Added ${topExpansion.length} expansion hits from link-aware search`);
        reranked.push(...topExpansion);
      }
    }

    // Return scored chunks (preserving scores for downstream filtering)
    return reranked.map(hit => ({ content: hit.content, rrfScore: hit.rrfScore }));
  } catch (err) {
    console.error("Vector search failed:", err);
  }
  return [];
}

/**
 * Extract page names from search results that are also relevant to the query.
 * Looks for [[page_name]] links (in raw content) and note_links/note_backlinks headers
 * (in normalized content where brackets are stripped).
 * Returns page names that appear in both the results' links AND the query terms.
 */
function extractPageRefsFromResults(contents: string[], query: string): string[] {
  const linkRegex = /\[\[(.+?)\]\]/g;
  const pageNames = new Set<string>();

  for (const content of contents) {
    // Parse [[page]] links (may exist in non-normalized content)
    let match: RegExpExecArray | null;
    while ((match = linkRegex.exec(content)) !== null) {
      pageNames.add(match[1]);
    }
    // Parse note_links header (normalized content format: "note_links: Page1, Page2, ...")
    const linksMatch = content.match(/note_links:\s*(.+)/);
    if (linksMatch) {
      const links = linksMatch[1].split(',').map(s => s.trim()).filter(Boolean);
      for (const link of links) {
        pageNames.add(link);
      }
    }
    // Parse note_backlinks header
    const backlinksMatch = content.match(/note_backlinks:\s*(.+)/);
    if (backlinksMatch) {
      const links = backlinksMatch[1].split(',').map(s => s.trim()).filter(Boolean);
      for (const link of links) {
        pageNames.add(link);
      }
    }
    // Parse note_name header (the page itself is a relevant reference)
    const nameMatch = content.match(/note_name:\s*(.+)/);
    if (nameMatch) {
      pageNames.add(nameMatch[1].trim());
    }
  }

  if (pageNames.size === 0) return [];

  // Filter to page names whose terms overlap with the query
  const queryTerms = new Set(query.toLowerCase().split(/[\s\p{P}]+/u).filter(Boolean));
  const relevant: string[] = [];

  for (const pageName of pageNames) {
    const pageTerms = pageName.toLowerCase().split(/[\s\p{P}]+/u).filter(Boolean);
    const overlap = pageTerms.filter(t => queryTerms.has(t));
    // Page name is relevant if at least 40% of its terms appear in the query
    if (overlap.length > 0 && overlap.length >= pageTerms.length * 0.4) {
      relevant.push(pageName);
    }
  }

  return relevant;
}

/**
 * Extract potential page names directly from the user's query.
 * Looks for multi-word phrases in the query that match page names found in indexed content
 * (by checking note_name headers in results), or capitalized multi-word sequences.
 * This catches cases like "QEN Team Member" where the user refers to a page by name.
 */
function extractPageNamesFromQuery(query: string, resultContents: string[]): string[] {
  const pageNames: string[] = [];

  // 1. Extract note_name values from search results to know what pages exist
  const knownPages = new Set<string>();
  for (const content of resultContents) {
    const nameMatch = content.match(/note_name:\s*(.+)/);
    if (nameMatch) {
      knownPages.add(nameMatch[1].trim().toLowerCase());
    }
    // Also extract page names from [[...]] links in content
    const linkRegex = /\[\[(.+?)\]\]/g;
    let linkMatch: RegExpExecArray | null;
    while ((linkMatch = linkRegex.exec(content)) !== null) {
      knownPages.add(linkMatch[1].toLowerCase());
    }
  }

  // 2. Check if any known page name appears as a substring of the query
  const queryLower = query.toLowerCase();
  for (const pageName of knownPages) {
    if (pageName.length >= 3 && queryLower.includes(pageName)) {
      pageNames.push(pageName);
    }
  }

  // 3. Also look for capitalized multi-word sequences that might be page names
  //    e.g. "QEN Team Member" in "show Data QEN Team Member table"
  const capitalizedPhrases = query.match(/(?:[A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*)+)/g);
  if (capitalizedPhrases) {
    for (const phrase of capitalizedPhrases) {
      const phraseLower = phrase.toLowerCase();
      if (!pageNames.includes(phraseLower) && phrase.length >= 3) {
        pageNames.push(phraseLower);
      }
    }
  }

  return pageNames;
}

/** Inject agent memory into system prompt. */
function injectMemoryContext(query: string, settings: any, userBudget: number, vectorContext: string): { memoryText: string; accessedIds: string[] } {
  if (!settings.memoryEnabled || !memoryStore) return { memoryText: '', accessedIds: [] };
  const memBudget = Math.floor(userBudget * Math.min(25, Math.max(1, settings.memoryBudgetPercent || 10)) / 100);
  const preferences = memoryStore.getMemories({ category: 'preference' });
  const summaries = memoryStore.getMemories({ category: 'session_summary' }).slice(0, 3);
  const keywordMatches = memoryStore.searchMemories(query);
  const memoryPageHits = vectorContext
    .split('\n\n')
    .filter(chunk => chunk.includes('mixer-memory') || chunk.includes('Mixer/Memory'))
    .map(chunk => ({ id: 'rag-' + chunk.slice(0, 20), category: 'fact' as string, content: chunk.slice(0, 200), createdAt: 0, lastAccessed: null, source: 'rag', metadata: null }));
  const allMemories = [...preferences, ...summaries, ...keywordMatches, ...memoryPageHits];
  const seen = new Set<string>();
  const unique = allMemories.filter(m => { if (seen.has(m.id)) return false; seen.add(m.id); return true; });
  if (unique.length === 0) return { memoryText: '', accessedIds: [] };
  let memText = '\n\nYour memories from past interactions with this user:\n' + unique.map(m => `- [${m.category}] ${m.content}`).join('\n');
  memText = truncateToTokens(memText, memBudget);
  return { memoryText: memText, accessedIds: unique.filter(m => !m.id.startsWith('rag-')).map(m => m.id) };
}

/** Build conversation history messages within a token budget. */
function buildHistoryMessages(historyBudget: number): { messages: ChatMessage[]; tokensUsed: number } {
  const historyForMessages = conversationHistory.slice(0, -1).slice(-MAX_HISTORY_LENGTH);
  const messages: ChatMessage[] = [];
  let tokensUsed = 0;
  for (let i = historyForMessages.length - 1; i >= 0; i--) {
    const entry = historyForMessages[i];
    const entryTokens = countTokens(entry.content);
    if (tokensUsed + entryTokens > historyBudget && messages.length > 0) break;
    messages.unshift({ role: entry.role, content: entry.content });
    tokensUsed += entryTokens;
  }
  return { messages, tokensUsed };
}

/** Fetch current page context within a token budget. */
async function fetchPageContext(budget: number): Promise<string> {
  try {
    let page = await logseq.Editor.getCurrentPage();
    const currentBlock = await logseq.Editor.getCurrentBlock();
    if (page === null) {
      if (currentBlock && currentBlock.page) page = await logseq.Editor.getPage(currentBlock.page.id);
    }
    // Exclude internal Mixer system pages
    if (page !== null) {
      const pName = String((page as any).name || '');
      if (pName.toLowerCase().startsWith('mixer/')) {
        page = null;
      }
    }
    if (page !== null) {
      const pageContent = await logseq.Editor.getPageBlocksTree(page.uuid);
      const formatBlock = (b: any, depth = 0): string => {
        const indent = '  '.repeat(depth);
        let text = `${indent}- [uuid:${b.uuid}] ${b.content}\n`;
        if (b.children) {
          for (const child of b.children) text += formatBlock(child, depth + 1);
        }
        return text;
      };
      const wholePageContent = pageContent.map((b: any) => formatBlock(b)).join('');
      let rawPageContext = "Current Page Context (block tree where indentation = sub-blocks/children of the parent above):\n" +
        `current_page_open_id: ${page.id}\ncurrent_page_open_name: ${page.name}\n`;
      // Include current/focused block info so the AI knows which block the user is referring to
      if (currentBlock) {
        rawPageContext += `current_focused_block_uuid: ${currentBlock.uuid}\n`;
        rawPageContext += `current_focused_block_content: ${currentBlock.content || ''}\n`;
        rawPageContext += `(When the user says "this block" or "current block", they mean the focused block above. Its sub-blocks are the indented blocks directly beneath it in the tree below.)\n`;
      }
      rawPageContext += `current_page_open_content:\n${wholePageContent}\n\n`;
      return truncateToTokens(rawPageContext, budget);
    }
  } catch (err) {
    console.error("Failed to retrieve current page context:", err);
  }
  return '';
}

/**
 * Filter scored chunks by relevance using adaptive thresholding.
 * If the top result has a high score, we raise the bar for what's "relevant enough"
 * to include — preventing noisy low-scoring chunks from diluting good context.
 */
function filterByRelevance(chunks: ScoredChunk[], absoluteFloor: number): ScoredChunk[] {
  if (chunks.length === 0) return [];

  // Always keep chunks above the absolute floor
  const aboveFloor = chunks.filter(c => c.rrfScore >= absoluteFloor);
  if (aboveFloor.length === 0) return [];

  // Adaptive threshold: if we have strong results, drop the weak tail.
  // Threshold = max_score * 0.15 (keep chunks scoring at least 15% of the best)
  const maxScore = aboveFloor[0].rrfScore; // chunks are already sorted by score
  const adaptiveThreshold = Math.max(absoluteFloor, maxScore * 0.15);

  const filtered = aboveFloor.filter(c => c.rrfScore >= adaptiveThreshold);
  if (filtered.length < aboveFloor.length) {
    console.info(`[filterByRelevance] Adaptive threshold ${adaptiveThreshold.toFixed(4)} (max=${maxScore.toFixed(4)}) dropped ${aboveFloor.length - filtered.length} weak chunks`);
  }

  return filtered;
}

/**
 * Grounding instructions appended to the system prompt when RAG context is provided.
 * These instruct the model to base its response on the retrieved context and cite sources.
 */
const GROUNDING_INSTRUCTIONS = `

## Grounding Rules
- Base your response primarily on the retrieved context provided below. Do not invent or hallucinate information not present in the context.
- If the retrieved context does not contain sufficient information to answer the user's question, clearly state what you can answer from the context and what information is missing or unavailable.
- When referencing specific information from the context, cite the source block using ((uuid)) format if a uuid is available in the context.
- If the context contains conflicting information, acknowledge both perspectives rather than silently choosing one.
- You may use your general knowledge to explain, synthesize, or contextualize the retrieved information, but clearly distinguish between what comes from the user's notes vs. general knowledge.`;

export async function handleQuery(query: string, settings: any, storageProvider: StorageProvider, signal?: AbortSignal, editMode?: boolean, imageDataUrl?: string | string[]): Promise<string | EditQueryResult> {
  lastMemorySaved = false;
  pendingAgentGoal = null;

  // Detect multi-step goals and route to agent loop
  // Skip goal detection when an image is attached — images need the multipart message path
  // Skip goal detection when edit mode is on — edit mode handles write requests directly
  if (settings.agentMode === 'on' && !editMode && !imageDataUrl && (await detectGoal(query, settings.agentConfidenceThreshold || 0.6, settings)).isGoal) {
    pendingAgentGoal = query;
    return '__AGENT_GOAL_DETECTED__';
  }

  // Add the new user query to the conversation history
  conversationHistory.push({ role: "user", content: query });

  // Determine whether RAG retrieval is needed for this query
  // Skip retrieval when images are attached — the user is asking about the image, not their notes
  const hasImages = !!imageDataUrl && (Array.isArray(imageDataUrl) ? imageDataUrl.length > 0 : true);
  const needsRetrieval = !hasImages && shouldRetrieveContext(query);
  console.info(`[handleQuery] needsRetrieval=${needsRetrieval}, hasImages=${hasImages}`);

  // --- Query rewriting for better retrieval ---
  // Rewrite the query to resolve pronouns/references from conversation history.
  // The rewritten query is used ONLY for retrieval, not for the final prompt to the LLM.
  let retrievalQuery = query;
  if (needsRetrieval && conversationHistory.length > 1) {
    retrievalQuery = await rewriteQueryForRetrieval(query, conversationHistory.slice(0, -1), settings, signal);
  }

  // --- Retrieval with scored results ---
  const scoredChunks: ScoredChunk[] = needsRetrieval
    ? await retrieveVectorContext(retrievalQuery, settings, storageProvider)
    : [];
  console.info(`[handleQuery] Retrieved ${scoredChunks.length} scored chunks`);

  // --- Relevance filtering ---
  // Drop chunks with very low RRF scores that are unlikely to be helpful.
  // The minimum threshold (0.025) is already applied in hybridSearch, but here we apply
  // a higher adaptive threshold: if we have high-scoring results, drop the tail.
  const RELEVANCE_FLOOR = 0.03; // absolute minimum to keep
  const relevantChunks = filterByRelevance(scoredChunks, RELEVANCE_FLOOR);
  console.info(`[handleQuery] After relevance filtering: ${relevantChunks.length}/${scoredChunks.length} chunks kept`);

  // Join filtered chunks into context string
  const vectorContext = relevantChunks.map(c => c.content).join('\n\n');

  // Build system message
  let systemMessage = settings.prompt;
  let editPageContext: Awaited<ReturnType<typeof getActivePageContext>> = null;
  if (editMode) {
    try { editPageContext = await getActivePageContext(); } catch {}
    systemMessage += '\n\n' + buildEditSystemPrompt();
  }

  // Conditionally inject diagram rules if the query is about diagrams/charts
  if (isDiagramIntent(query)) {
    systemMessage += '\n' + DIAGRAM_RULES;
  }

  // Inject grounding instructions when RAG context was retrieved
  if (vectorContext) {
    systemMessage += GROUNDING_INSTRUCTIONS;
  }

  // Calculate token budgets
  const systemTokens = countTokens(systemMessage);
  const contextLimit = getContextLimitForModel(settings.selectedModel);
  const maxOutput = getMaxTokensForModel(settings.selectedModel);
  const totalInputBudget = Math.max(1024, contextLimit - maxOutput - 500);
  let userBudget = Math.max(1024, totalInputBudget - systemTokens);

  // Inject memory
  const { memoryText, accessedIds } = injectMemoryContext(query, settings, userBudget, vectorContext);
  if (memoryText) {
    console.info(`[handleQuery] Memory injected: ${countTokens(memoryText)} tokens, ${accessedIds.length} memory entries`);
    systemMessage += memoryText;
    userBudget -= countTokens(memoryText);
    memoryStore!.updateLastAccessed(accessedIds);
  } else {
    console.info('[handleQuery] No memory injected');
  }

  // Build edit context
  let editContextText = "";
  if (editMode && editPageContext) {
    const rawEditContext = buildPageContextMessage(editPageContext.pageName, editPageContext.pageUUID, editPageContext.selectedBlockUUID, editPageContext.selectedBlockContent, editPageContext.isSelectedBlockEmpty, editPageContext.formattedTree);
    const limit = Math.floor(userBudget * 0.35);
    editContextText = truncateToTokens(rawEditContext, limit);
    userBudget -= countTokens(editContextText);
  }

  // Build history
  const historyBudget = Math.floor(userBudget * 0.20);
  const { messages: historyMessages, tokensUsed: historyTokensUsed } = buildHistoryMessages(historyBudget);
  userBudget -= historyTokensUsed;

  // Build page context
  const pageContextText = await fetchPageContext(Math.floor(userBudget * 0.25));
  userBudget -= countTokens(pageContextText);

  // Build vector context text
  let vectorContextText = "";
  if (vectorContext) {
    vectorContextText = truncateToTokens(vectorContext, userBudget);
    userBudget -= countTokens(vectorContextText);
  }

  // --- Build context message (separate from user query for better attention) ---
  // Research shows models attend more reliably to context placed before the query.
  // We assemble retrieved context as a separate user message labeled as reference material.
  let contextBlock = "";
  if (vectorContextText) {
    contextBlock += "## Retrieved Context from Knowledge Base\n" + vectorContextText + "\n";
  }
  if (pageContextText) {
    contextBlock += "\n## Current Page Context\n" + pageContextText + "\n";
  }
  if (editContextText) {
    contextBlock += "\n## Edit Target\n" + editContextText + "\n";
  }

  // --- Assemble user message (clean — just the user's request + image notes) ---
  let userMessage = query;
  // Normalize imageDataUrl to array
  const images: string[] = imageDataUrl
    ? (Array.isArray(imageDataUrl) ? imageDataUrl : [imageDataUrl])
    : [];

  if (editMode && images.length > 0) {
    userMessage += `\n\nNote: The user has attached ${images.length > 1 ? images.length + ' images' : 'an image'}. Use "![attached image]()" as placeholder.`;
  } else if (images.length > 0) {
    userMessage += `\n\n[${images.length > 1 ? images.length + ' images are' : 'An image is'} attached below. Analyze the image content to answer the user's request.]`;
  }

  const userContent: string | MessageContentPart[] = images.length > 0
    ? [
        { type: 'text', text: userMessage } as MessageContentPart,
        ...images.map(url => ({ type: 'image_url', image_url: { url } }) as MessageContentPart),
      ]
    : userMessage;

  // --- Assemble final messages array ---
  // Structure: system → history → [context block] → user query
  // Context as a separate message ensures the model sees it before the query,
  // improving attention and grounding without polluting the user's actual message.
  const messages: ChatMessage[] = [
    { role: 'system', content: systemMessage },
    ...historyMessages,
    ...(contextBlock ? [{ role: 'user' as const, content: `[Reference material for answering the next question — do not treat as a user request]\n\n${contextBlock}` }] : []),
    ...(contextBlock ? [{ role: 'assistant' as const, content: 'I have reviewed the reference material. Please go ahead with your question.' }] : []),
    { role: 'user', content: userContent },
  ];

  // Execute via ReAct loop
  const tools = MCPManager.getInstance().getEnabledTools();
  const reactResult = await runReActLoop(messages, {
    settings, signal,
    maxIterations: settings.agentMaxIterations || 25,
    tokenBudget: 0,
    tools,
    includeLogseqTools: true,
    includeLogseqWriteTools: !!editMode,
    onThought: onThoughtCallback || undefined,
  });

  const assistantResponse = reactResult.answer;
  conversationHistory.push({ role: "assistant", content: assistantResponse });
  if (conversationHistory.length > MAX_HISTORY_LENGTH * 2) {
    conversationHistory.splice(0, conversationHistory.length - MAX_HISTORY_LENGTH * 2);
  }

  // Detect and store explicit memory
  if (settings.memoryEnabled && memoryStore) {
    const detected = detectExplicitMemory(query);
    if (detected) { memoryStore.addMemoryIfUnique(detected.category, detected.content, 'explicit'); lastMemorySaved = true; }
  }

  if (editMode) {
    const parseResult = parseEditCommands(assistantResponse);
    return { text: parseResult.textWithoutEditBlocks, commands: parseResult.commands };
  }
  return assistantResponse;
}
