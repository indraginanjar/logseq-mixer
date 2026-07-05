import { getActivePageContext } from 'blockTreeFormatter';
import { BM25Index } from 'bm25Index';
import { parseEditCommands } from 'editCommandParser';
import { buildEditSystemPrompt, buildPageContextMessage } from 'editPromptBuilder';
import { clearRefCache, useGenerateEmbedding } from 'embedManager';
import { hybridSearch } from 'hybridSearch';
import { checkAndIndexUpdatedPages, startPageIndexingOnChange, type IndexingResult } from 'indexManager';
import { queryLiteLLM, type ChatMessage, type MessageContentPart, getContextLimitForModel, getMaxTokensForModel } from 'LLMManager';
import { rerankWithRRF, type SearchHit } from 'reranker';
import { countTokens, encode, decode } from 'tokenizer';
import { getOrLoadVectorDatabase, loadVectorDatabase, vectorSearchOramaDB } from 'VectorDBManager';
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

/** Clear the conversation history for a fresh session. */
export function clearConversationHistory(): void {
  conversationHistory.length = 0;
}

/**
 * Duck-typing check: returns true when the storage provider supports
 * per-document vector search (SQLiteVectorStore), false for the legacy
 * Orama-based path (SettingsStorageProvider).
 */
function hasSearchByVector(provider: any): provider is PerDocumentStorageProvider {
  return typeof provider?.searchByVector === 'function';
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

  if (hasSearchByVector(storageProvider)) {
    // Check chunking version for migration
    if (storageProvider instanceof SQLiteVectorStore) {
      const storedVersion = storageProvider.getChunkingVersion();
      if (storedVersion !== CURRENT_CHUNKING_VERSION) {
        console.info('[indexEntireLogSeq] Chunking version mismatch, forcing full re-index.');
        await storageProvider.clear();
        resetBM25Index();
        storageProvider.setChunkingVersion(CURRENT_CHUNKING_VERSION);
      }
    }

    // Per-document path: always incremental indexing
    const result = await checkAndIndexUpdatedPages(settings.apiKey, undefined, settings.EmbeddingApiKey, settings.embeddingModel, storageProvider, settings.embeddingEndpoint, settings.embeddingProvider, accelerator ?? undefined);
    // Invalidate BM25 index so it rebuilds lazily from the updated store on next query
    resetBM25Index();
    return result;
  } else {
    // Legacy Orama-based path
    const oramaDatabaseInstance = await loadVectorDatabase(settings, false, settings.embeddingModel, storageProvider);
    const result = await checkAndIndexUpdatedPages(settings.apiKey, oramaDatabaseInstance, settings.EmbeddingApiKey, settings.embeddingModel, storageProvider, settings.embeddingEndpoint, settings.embeddingProvider);
    return result;
  }
}

export async function enableAutoIndexer(settings: any, storageProvider: StorageProvider) {
  if (hasSearchByVector(storageProvider)) {
    // Per-document path: no Orama instance needed
    startPageIndexingOnChange(settings.apiKey, undefined, settings.EmbeddingApiKey, settings.embeddingModel, storageProvider, settings.embeddingEndpoint, settings.embeddingProvider, accelerator ?? undefined);
  } else {
    // Legacy Orama-based path
    const oramaDatabaseInstance = await loadVectorDatabase(settings, false, settings.embeddingModel, storageProvider);
    startPageIndexingOnChange(settings.apiKey, oramaDatabaseInstance, settings.EmbeddingApiKey, settings.embeddingModel, storageProvider, settings.embeddingEndpoint, settings.embeddingProvider);
  }
}

function truncateToTokens(text: string, maxTokens: number): string {
  if (maxTokens <= 0) return "";
  const tokens = encode(text);
  if (tokens.length <= maxTokens) return text;
  return decode(tokens.slice(0, maxTokens)) + "\n... (truncated to fit model context limit)";
}

/** Retrieve relevant vector context for a query. */
async function retrieveVectorContext(query: string, settings: any, storageProvider: StorageProvider): Promise<string> {
  try {
    const queryEmbedding = await useGenerateEmbedding(query, settings.EmbeddingApiKey, settings.embeddingModel, settings.embeddingEndpoint, settings.embeddingProvider);
    if (hasSearchByVector(storageProvider)) {
      const index = ensureBM25Index(storageProvider);
      const reranked = await hybridSearch(query, queryEmbedding, storageProvider, index, { accelerator: accelerator ?? undefined });
      return reranked.map(hit => hit.content).join('\n\n');
    } else {
      const oramaDatabaseInstance = await getOrLoadVectorDatabase(settings, settings.embeddingModel, storageProvider);
      const vectorResult = await vectorSearchOramaDB(oramaDatabaseInstance, queryEmbedding);
      const searchHits: SearchHit[] = (vectorResult.hits ?? []).map(hit => ({
        id: hit.document.id as string, content: hit.document.content as string, score: hit.score,
      }));
      if (searchHits.length > 0) {
        return rerankWithRRF(searchHits, query).map(hit => hit.content).join('\n\n');
      }
    }
  } catch (err) {
    console.error("Vector search failed:", err);
  }
  return '';
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
    if (page === null) {
      const currentBlock = await logseq.Editor.getCurrentBlock();
      if (currentBlock && currentBlock.page) page = await logseq.Editor.getPage(currentBlock.page.id);
    }
    if (page !== null) {
      const pageContent = await logseq.Editor.getPageBlocksTree(page.uuid);
      let wholePageContent = "";
      pageContent.forEach(element => { wholePageContent += "- " + element.content + "\n"; });
      const rawPageContext = "Current Page Context:\n" +
        `current_page_open_id: ${page.id}\ncurrent_page_open_name: ${page.name}\ncurrent_page_open_content: ${wholePageContent}\n\n`;
      return truncateToTokens(rawPageContext, budget);
    }
  } catch (err) {
    console.error("Failed to retrieve current page context:", err);
  }
  return '';
}

export async function handleQuery(query: string, settings: any, storageProvider: StorageProvider, signal?: AbortSignal, editMode?: boolean, imageDataUrl?: string): Promise<string | EditQueryResult> {
  lastMemorySaved = false;
  pendingAgentGoal = null;

  // Detect multi-step goals and route to agent loop
  if (settings.agentMode === 'on' && !editMode && (await detectGoal(query, settings.agentConfidenceThreshold || 0.6, settings)).isGoal) {
    pendingAgentGoal = query;
    return '__AGENT_GOAL_DETECTED__';
  }

  // Add the new user query to the conversation history
  conversationHistory.push({ role: "user", content: query });

  const vectorContext = await retrieveVectorContext(query, settings, storageProvider);

  // Build system message
  let systemMessage = settings.prompt;
  let editPageContext: Awaited<ReturnType<typeof getActivePageContext>> = null;
  if (editMode) {
    try { editPageContext = await getActivePageContext(); } catch {}
    systemMessage += '\n\n' + buildEditSystemPrompt();
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
    systemMessage += memoryText;
    userBudget -= countTokens(memoryText);
    memoryStore!.updateLastAccessed(accessedIds);
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
    vectorContextText = truncateToTokens("Additional Context from Knowledge Base:\n" + vectorContext, userBudget);
    userBudget -= countTokens(vectorContextText);
  }

  // Assemble user message
  let userMessage = pageContextText + vectorContextText + editContextText;
  if (editMode && imageDataUrl) {
    userMessage += `\nNote: The user has attached an image. Use "![attached image]()" as placeholder.\n\n`;
  }
  userMessage += query;

  const userContent: string | MessageContentPart[] = imageDataUrl
    ? [{ type: 'text', text: userMessage }, { type: 'image_url', image_url: { url: imageDataUrl } }]
    : userMessage;

  const messages: ChatMessage[] = [
    { role: 'system', content: systemMessage },
    ...historyMessages,
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
