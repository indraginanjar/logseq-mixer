import { clearRefCache, useGenerateEmbedding } from 'embedManager';
import { checkAndIndexUpdatedPages, startPageIndexingOnChange } from 'indexManager';
import { queryLiteLLM } from 'LLMManager';
import { rerankWithRRF, type SearchHit } from 'reranker';
import { getOrLoadVectorDatabase, loadVectorDatabase, vectorSearchOramaDB } from 'VectorDBManager';
import type { StorageProvider } from './storage/StorageProvider';

// Global variable to store conversation history
const conversationHistory: Array<{ role: 'user' | 'assistant', content: string }> = [];
// Set maximum number of history messages to include in the prompt (e.g., last 6 messages)
const MAX_HISTORY_LENGTH = 6;

export async function indexEntireLogSeq(settings: any, storageProvider: StorageProvider) {
  clearRefCache();
  // Always load existing DB — never wipe it. Both modes index incrementally
  // so the user can query while indexing is in progress.
  const oramaDatabaseInstance = await loadVectorDatabase(settings, false, settings.embeddingModel, storageProvider);
  await checkAndIndexUpdatedPages(settings.apiKey, oramaDatabaseInstance, settings.EmbeddingApiKey, settings.embeddingModel, storageProvider);
}

export async function enableAutoIndexer(settings: any, storageProvider: StorageProvider) {
  const oramaDatabaseInstance = await loadVectorDatabase(settings, false, settings.embeddingModel, storageProvider);
  startPageIndexingOnChange(settings.apiKey, oramaDatabaseInstance, settings.EmbeddingApiKey, settings.embeddingModel, storageProvider);
}

export async function handleQuery(query: string, settings: any, storageProvider: StorageProvider): Promise<string> {
  // Add the new user query to the conversation history
  conversationHistory.push({ role: "user", content: query });

  let vectorContext = "";

  // Wrap vector search in try/catch to prevent indexing issues from blocking LLM query.
  try {
    const oramaDatabaseInstance = await getOrLoadVectorDatabase(settings, settings.embeddingModel, storageProvider);
    const queryEmbedding = await useGenerateEmbedding(query, settings.EmbeddingApiKey, settings.embeddingModel);
    
    console.info(`[handleQuery] Query embedding dimensions: ${queryEmbedding?.length}, model: ${settings.embeddingModel}`);
    console.info(`[handleQuery] Embedding sample (first 5): ${queryEmbedding?.slice(0, 5)}`);
    
    const vectorResult = await vectorSearchOramaDB(oramaDatabaseInstance, queryEmbedding);
    
    console.info(`[handleQuery] Vector search returned ${vectorResult.hits?.length ?? 0} hits (count: ${vectorResult.count})`);

    // Rerank vector search results using RRF before building context.
    if (vectorResult.hits && vectorResult.hits.length > 0) {
      const searchHits: SearchHit[] = vectorResult.hits.map(hit => ({
        id: hit.document.id as string,
        content: hit.document.content as string,
        score: hit.score,
      }));

      const reranked = rerankWithRRF(searchHits, query);
      console.info(`[handleQuery] After reranking: ${reranked.length} results`);
      reranked.forEach(hit => {
        vectorContext += hit.content + "\n\n";
      });
    }
  } catch (err) {
    console.error("Vector search failed, proceeding without additional context:", err);
    vectorContext = "";
  }

  console.info(`[handleQuery] vectorContext length: ${vectorContext.length} chars`);
  if (vectorContext) {
    console.info(`[handleQuery] vectorContext preview: ${vectorContext.slice(0, 200)}...`);
  }

  // Construct prompt starting with your base prompt.
  let prompt = settings.prompt + "\n";

  // Append recent conversation history (limited to the most recent MAX_HISTORY_LENGTH messages)
  const recentHistory = conversationHistory.slice(-MAX_HISTORY_LENGTH);
  if (recentHistory.length > 0) {
    prompt += "Conversation History:\n";
    recentHistory.forEach(entry => {
      prompt += entry.role === "user"
        ? "User: " + entry.content + "\n"
        : "Assistant: " + entry.content + "\n";
    });
    prompt += "\n";
  }

  // Try to include the current page context, but do not fail if it cannot be retrieved.
  try {
    const page = await logseq.Editor.getCurrentPage();
    if (page !== null) {
      const pageContent = await logseq.Editor.getPageBlocksTree(page.uuid);
      let wholePageContent = "";
      pageContent.forEach(element => {
        wholePageContent += "- " + element.content + "\n";
      });
      prompt += "Current Page Context:\n";
      prompt += `current_page_open_id: ${page.id}\n`;
      prompt += `current_page_open_name: ${page.name}\n`;
      prompt += `current_page_open_content: ${wholePageContent}\n\n`;
    }
  } catch (err) {
    console.error("Failed to retrieve current page context:", err);
  }

  // Append additional context from vector search if available.
  if (vectorContext) {
    prompt += "Additional Context from Knowledge Base:\n";
    prompt += vectorContext;
  }

  // Query the LLM with the complete prompt.
  const llmOutput = await queryLiteLLM(prompt, settings.selectedModel, settings.apiKey, settings.LiteLLMLink);
  const assistantResponse = llmOutput.choices[0].message["content"];

  // Add the assistant's answer to the conversation history.
  conversationHistory.push({ role: "assistant", content: assistantResponse });

  // Trim conversation history if it grows too large.
  if (conversationHistory.length > MAX_HISTORY_LENGTH * 2) {
    conversationHistory.splice(0, conversationHistory.length - MAX_HISTORY_LENGTH * 2);
  }

  return assistantResponse;
}

