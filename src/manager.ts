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

    // Per-document path: clear the store first when in full mode
    if (settings.indexingMode === 'full') {
      console.info('[indexEntireLogSeq] Full mode: clearing documents table before re-index.');
      await storageProvider.clear();
      resetBM25Index();
      accelerator?.dispose();
    }
    const result = await checkAndIndexUpdatedPages(settings.apiKey, undefined, settings.EmbeddingApiKey, settings.embeddingModel, storageProvider, settings.embeddingEndpoint, settings.embeddingProvider, accelerator ?? undefined);
    // Invalidate BM25 index so it rebuilds lazily from the updated store on next query
    resetBM25Index();
    // Re-initialize accelerator after full re-index (it was disposed above)
    if (settings.indexingMode === 'full' && accelerator) {
      await accelerator.initialize();
    }
    return result;
  } else {
    // Legacy Orama-based path: forceNew=true when full mode
    const forceNew = settings.indexingMode === 'full';
    const oramaDatabaseInstance = await loadVectorDatabase(settings, forceNew, settings.embeddingModel, storageProvider);
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

export async function handleQuery(query: string, settings: any, storageProvider: StorageProvider, signal?: AbortSignal, editMode?: boolean, imageDataUrl?: string): Promise<string | EditQueryResult> {
  lastMemorySaved = false;
  pendingAgentGoal = null;

  // Detect multi-step goals and route to agent loop
  if (settings.agentEnabled && !editMode && detectGoal(query).isGoal) {
    pendingAgentGoal = query;
    return '__AGENT_GOAL_DETECTED__';
  }

  // Add the new user query to the conversation history
  conversationHistory.push({ role: "user", content: query });

  let vectorContext = "";

  // Wrap vector search in try/catch to prevent indexing issues from blocking LLM query.
  try {
    const queryEmbedding = await useGenerateEmbedding(query, settings.EmbeddingApiKey, settings.embeddingModel, settings.embeddingEndpoint, settings.embeddingProvider);

    console.info(`[handleQuery] Query embedding dimensions: ${queryEmbedding?.length}, model: ${settings.embeddingModel}`);
    console.info(`[handleQuery] Embedding sample (first 5): ${queryEmbedding?.slice(0, 5)}`);

    if (hasSearchByVector(storageProvider)) {
      // Per-document path: hybrid search (BM25 + vector, merged via RRF)
      const index = ensureBM25Index(storageProvider);
      const reranked = await hybridSearch(query, queryEmbedding, storageProvider, index, { accelerator: accelerator ?? undefined });
      console.info(`[handleQuery] Hybrid search returned ${reranked.length} results`);
      reranked.forEach(hit => {
        vectorContext += hit.content + "\n\n";
      });
    } else {
      // Legacy Orama-based path
      const oramaDatabaseInstance = await getOrLoadVectorDatabase(settings, settings.embeddingModel, storageProvider);
      const vectorResult = await vectorSearchOramaDB(oramaDatabaseInstance, queryEmbedding);
      console.info(`[handleQuery] Vector search returned ${vectorResult.hits?.length ?? 0} hits (count: ${vectorResult.count})`);
      const searchHits: SearchHit[] = (vectorResult.hits ?? []).map(hit => ({
        id: hit.document.id as string,
        content: hit.document.content as string,
        score: hit.score,
      }));

      // Rerank legacy Orama results using RRF before building context.
      if (searchHits.length > 0) {
        const reranked = rerankWithRRF(searchHits, query);
        console.info(`[handleQuery] After reranking: ${reranked.length} results`);
        reranked.forEach(hit => {
          vectorContext += hit.content + "\n\n";
        });
      }
    }
  } catch (err) {
    console.error("Vector search failed, proceeding without additional context:", err);
    vectorContext = "";
  }

  console.info(`[handleQuery] vectorContext length: ${vectorContext.length} chars`);
  if (vectorContext) {
    console.info(`[handleQuery] vectorContext preview: ${vectorContext.slice(0, 200)}...`);
  }

  // Build the system message from the settings prompt.
  let systemMessage = settings.prompt;

  // When edit mode is enabled, fetch page context and augment prompts.
  let editPageContext: Awaited<ReturnType<typeof getActivePageContext>> = null;
  if (editMode) {
    try {
      editPageContext = await getActivePageContext();
    } catch (err) {
      console.error('[handleQuery] Failed to get active page context for edit mode:', err);
    }
    systemMessage += '\n\n' + buildEditSystemPrompt();
  }

  // Estimate context token budget to avoid context window overflow errors.
  const systemTokens = countTokens(systemMessage);
  const contextLimit = getContextLimitForModel(settings.selectedModel);
  const maxOutput = getMaxTokensForModel(settings.selectedModel);
  const safetyMargin = 500;
  const totalInputBudget = Math.max(1024, contextLimit - maxOutput - safetyMargin);
  let userBudget = Math.max(1024, totalInputBudget - systemTokens);

  console.info(`[handleQuery] Model: ${settings.selectedModel}, Context Limit: ${contextLimit}, Max Output: ${maxOutput}, Input Budget: ${totalInputBudget}, User Budget: ${userBudget}`);

  // Inject agent memory into system prompt
  if (settings.memoryEnabled && memoryStore) {
    const memBudget = Math.floor(userBudget * Math.min(25, Math.max(1, settings.memoryBudgetPercent || 10)) / 100);
    const preferences = memoryStore.getMemories({ category: 'preference' });
    const summaries = memoryStore.getMemories({ category: 'session_summary' }).slice(0, 3);
    const relevant = memoryStore.searchMemories(query);
    const allMemories = [...preferences, ...summaries, ...relevant];
    const seen = new Set<string>();
    const unique = allMemories.filter(m => { if (seen.has(m.id)) return false; seen.add(m.id); return true; });
    if (unique.length > 0) {
      let memText = '\n\nYour memories from past interactions with this user:\n' + unique.map(m => `- [${m.category}] ${m.content}`).join('\n');
      memText = truncateToTokens(memText, memBudget);
      systemMessage += memText;
      userBudget -= countTokens(memText);
      memoryStore.updateLastAccessed(unique.map(m => m.id));
    }
  }

  // Build the user message parts budget-consciously.
  let editContextText = "";
  if (editMode && editPageContext) {
    const rawEditContext = buildPageContextMessage(
      editPageContext.pageName,
      editPageContext.pageUUID,
      editPageContext.selectedBlockUUID,
      editPageContext.selectedBlockContent,
      editPageContext.isSelectedBlockEmpty,
      editPageContext.formattedTree
    );
    // Allocate up to 35% of userBudget
    const limit = Math.floor(userBudget * 0.35);
    editContextText = truncateToTokens(rawEditContext, limit);
    userBudget -= countTokens(editContextText);
  }

  // Build multi-turn history messages (excluding the current query which is already the last entry)
  const historyForMessages = conversationHistory.slice(0, -1).slice(-MAX_HISTORY_LENGTH);
  let historyTokenBudget = Math.floor(userBudget * 0.20);
  const historyMessages: ChatMessage[] = [];
  let historyTokensUsed = 0;
  for (let i = historyForMessages.length - 1; i >= 0; i--) {
    const entry = historyForMessages[i];
    const entryTokens = countTokens(entry.content);
    if (historyTokensUsed + entryTokens > historyTokenBudget && historyMessages.length > 0) {
      break;
    }
    historyMessages.unshift({ role: entry.role, content: entry.content });
    historyTokensUsed += entryTokens;
  }
  userBudget -= historyTokensUsed;

  let pageContextText = "";
  try {
    let page = await logseq.Editor.getCurrentPage();
    if (page === null) {
      const currentBlock = await logseq.Editor.getCurrentBlock();
      if (currentBlock && currentBlock.page) {
        page = await logseq.Editor.getPage(currentBlock.page.id);
      }
    }
    if (page !== null) {
      const pageContent = await logseq.Editor.getPageBlocksTree(page.uuid);
      let wholePageContent = "";
      pageContent.forEach(element => {
        wholePageContent += "- " + element.content + "\n";
      });
      const rawPageContext = "Current Page Context:\n" +
        `current_page_open_id: ${page.id}\n` +
        `current_page_open_name: ${page.name}\n` +
        `current_page_open_content: ${wholePageContent}\n\n`;
      // Allocate up to 25% of userBudget
      const limit = Math.floor(userBudget * 0.25);
      pageContextText = truncateToTokens(rawPageContext, limit);
      userBudget -= countTokens(pageContextText);
    }
  } catch (err) {
    console.error("Failed to retrieve current page context:", err);
  }

  let vectorContextText = "";
  if (vectorContext) {
    const rawVectorContext = "Additional Context from Knowledge Base:\n" + vectorContext;
    // Use the remaining userBudget
    vectorContextText = truncateToTokens(rawVectorContext, userBudget);
    userBudget -= countTokens(vectorContextText);
  }

  // Combine context into the current user message
  let userMessage = "";
  if (pageContextText) userMessage += pageContextText;
  if (vectorContextText) userMessage += vectorContextText;
  if (editContextText) userMessage += editContextText;
  if (editMode && imageDataUrl) {
    userMessage += `\nNote: The user has attached an image to this message. You can see it in the image content. If inserting it into a block, use "![attached image]()" as placeholder — the system will handle the actual image embedding via Logseq's native paste mechanism.\n\n`;
  }
  userMessage += query;

  // Build the messages array with proper multi-turn format
  const userContent: string | MessageContentPart[] = imageDataUrl
    ? [
        { type: 'text', text: userMessage },
        { type: 'image_url', image_url: { url: imageDataUrl } },
      ]
    : userMessage;

  const messages: ChatMessage[] = [
    { role: 'system', content: systemMessage },
    ...historyMessages,
    { role: 'user', content: userContent },
  ];

  console.info(`[handleQuery] System message length: ${systemMessage.length} chars`);
  console.info(`[handleQuery] System message preview: ${systemMessage.slice(0, 300)}...`);
  console.info(`[handleQuery] User message length: ${userMessage.length} chars`);

  // Query the LLM with the complete messages.
  const tools = MCPManager.getInstance().getEnabledTools();
  let llmOutput = await queryLiteLLM(messages, settings.selectedModel, settings.apiKey, settings.LiteLLMLink, signal, tools.length > 0 ? tools : undefined);
  let assistantMessage = llmOutput.choices[0]?.message;

  if (!assistantMessage) {
    throw new Error("No response message received from LiteLLM.");
  }

  // Tool calling loop
  let loopCount = 0;
  while (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0 && loopCount < 10) {
    loopCount++;
    console.info(`[handleQuery] Executing tool call loop step ${loopCount}, calls:`, assistantMessage.tool_calls);

    // 1. Append assistant message containing the tool calls
    messages.push({
      role: 'assistant',
      content: assistantMessage.content || '',
      tool_calls: assistantMessage.tool_calls
    });

    // 2. Execute all tool calls
    for (const toolCall of assistantMessage.tool_calls) {
      const funcName = toolCall.function.name;
      let args: any = {};
      try {
        args = typeof toolCall.function.arguments === 'string'
          ? JSON.parse(toolCall.function.arguments)
          : toolCall.function.arguments;
      } catch (e) {
        console.error(`[handleQuery] Failed to parse tool call arguments for ${funcName}:`, e);
      }

      let toolResult = "";
      try {
        toolResult = await MCPManager.getInstance().executeToolCall(funcName, args);
      } catch (err: any) {
        console.error(`[handleQuery] Error executing tool call ${funcName}:`, err);
        toolResult = `Error: ${err.message || err}`;
      }

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        name: funcName,
        content: toolResult
      });
    }

    // 3. Query LiteLLM again with updated messages
    llmOutput = await queryLiteLLM(messages, settings.selectedModel, settings.apiKey, settings.LiteLLMLink, signal, tools);
    assistantMessage = llmOutput.choices[0]?.message;
    if (!assistantMessage) {
      throw new Error("No response message received from LiteLLM after executing tool call.");
    }
  }

  const assistantResponse = assistantMessage.content || '';

  console.info(`[handleQuery] Raw LLM response preview: ${assistantResponse.slice(0, 500)}`);
  console.info('[handleQuery] Contains [[: ' + assistantResponse.includes('[[') + ', Contains ((: ' + assistantResponse.includes('(('));

  // Add the assistant's answer to the conversation history.
  conversationHistory.push({ role: "assistant", content: assistantResponse });

  // Trim conversation history if it grows too large.
  if (conversationHistory.length > MAX_HISTORY_LENGTH * 2) {
    conversationHistory.splice(0, conversationHistory.length - MAX_HISTORY_LENGTH * 2);
  }

  // Detect and store explicit memory requests
  if (settings.memoryEnabled && memoryStore) {
    const detected = detectExplicitMemory(query);
    if (detected) {
      memoryStore.addMemory(detected.category, detected.content);
      lastMemorySaved = true;
    }
  }

  // When edit mode is enabled, parse edit commands from the response.
  if (editMode) {
    const parseResult = parseEditCommands(assistantResponse);
    return {
      text: parseResult.textWithoutEditBlocks,
      commands: parseResult.commands,
    };
  }

  return assistantResponse;
}
