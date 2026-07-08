import { getActivePageContext } from 'blockTreeFormatter';
import { BM25Index } from 'bm25Index';
import { parseEditCommands } from 'editCommandParser';
import { buildEditSystemPrompt, buildPageContextMessage } from 'editPromptBuilder';
import { clearRefCache, useGenerateEmbedding } from 'embedManager';
import { hybridSearch } from 'hybridSearch';
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

async function retrieveVectorContext(query: string, settings: any, storageProvider: StorageProvider): Promise<string> {
  try {
    const queryEmbedding = await useGenerateEmbedding(query, settings.EmbeddingApiKey, settings.embeddingModel, settings.embeddingEndpoint, settings.embeddingProvider);
    const provider = storageProvider as PerDocumentStorageProvider;
    if (typeof provider.searchByVector !== 'function') return '';
    const index = ensureBM25Index(provider);
    const reranked = await hybridSearch(query, queryEmbedding, provider, index, { accelerator: accelerator ?? undefined });
    return reranked.map(hit => hit.content).join('\n\n');
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
        let text = `${indent}- ${b.content}\n`;
        if (b.children) {
          for (const child of b.children) text += formatBlock(child, depth + 1);
        }
        return text;
      };
      const wholePageContent = pageContent.map((b: any) => formatBlock(b)).join('');
      const rawPageContext = "Current Page Context:\n" +
        `current_page_open_id: ${page.id}\ncurrent_page_open_name: ${page.name}\ncurrent_page_open_content: ${wholePageContent}\n\n`;
      return truncateToTokens(rawPageContext, budget);
    }
  } catch (err) {
    console.error("Failed to retrieve current page context:", err);
  }
  return '';
}

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
  // Normalize imageDataUrl to array
  const images: string[] = imageDataUrl
    ? (Array.isArray(imageDataUrl) ? imageDataUrl : [imageDataUrl])
    : [];

  if (editMode && images.length > 0) {
    userMessage += `\nNote: The user has attached ${images.length > 1 ? images.length + ' images' : 'an image'}. Use "![attached image]()" as placeholder.\n\n`;
  }
  userMessage += query;

  const userContent: string | MessageContentPart[] = images.length > 0
    ? [
        { type: 'text', text: userMessage } as MessageContentPart,
        ...images.map(url => ({ type: 'image_url', image_url: { url } }) as MessageContentPart),
      ]
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
