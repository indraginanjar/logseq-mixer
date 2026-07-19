/**
 * Query rewriter for RAG retrieval.
 *
 * Rewrites the user's current query into a standalone, self-contained search query
 * by resolving pronouns and references from conversation history. This improves
 * retrieval quality in multi-turn conversations.
 *
 * Design decisions:
 * - Uses LLM-based rewriting (small, fast call) only when conversation history exists
 *   AND the query contains likely coreferences (pronouns, demonstratives, etc.)
 * - Falls back to the original query if rewriting fails or isn't needed
 * - Keeps the rewritten query concise — optimized for embedding similarity, not verbosity
 * - Does NOT rewrite the query sent to the LLM for generation — only for retrieval
 */

import { queryLiteLLM, type ChatMessage } from './LLMManager';

/** Patterns that suggest the query references prior conversation context */
const COREFERENCE_PATTERNS = [
  /\b(it|its|they|them|their|theirs|this|that|these|those)\b/i,
  /\b(the same|above|previous|earlier|last|mentioned|said)\b/i,
  /\b(also|too|another|more about|more on|what about)\b/i,
  /^(and|but|so|how|why|what|where|when)\b/i,  // starts with conjunction/question word (follow-up)
  /\?$/, // questions are often follow-ups
];

/**
 * Determine if a query likely needs rewriting based on conversation history.
 * Returns false if the query is already self-contained.
 */
export function needsQueryRewriting(
  query: string,
  conversationHistory: Array<{ role: string; content: string }>
): boolean {
  // No history → no need to rewrite
  if (conversationHistory.length === 0) return false;

  // If query is very long (>50 words), it's likely self-contained
  const wordCount = query.trim().split(/\s+/).length;
  if (wordCount > 50) return false;

  // Check if query contains coreference indicators
  return COREFERENCE_PATTERNS.some(p => p.test(query.trim()));
}

/**
 * System prompt for the query rewriter. Designed to be fast and focused.
 */
const REWRITE_SYSTEM_PROMPT = `You are a search query rewriter. Your job is to rewrite the user's latest message into a standalone search query that can be used to find relevant documents.

Rules:
- Resolve all pronouns and references using the conversation history
- Keep the rewritten query concise (under 30 words ideally)
- Preserve the user's original intent exactly
- Output ONLY the rewritten query, nothing else — no explanation, no quotes
- If the query is already self-contained, output it unchanged
- Do NOT add information the user didn't ask about`;

/**
 * Rewrite a query to be self-contained using conversation history.
 * Returns the original query if rewriting fails or isn't needed.
 */
export async function rewriteQueryForRetrieval(
  query: string,
  conversationHistory: Array<{ role: string; content: string }>,
  settings: any,
  signal?: AbortSignal
): Promise<string> {
  // Quick check: does this query even need rewriting?
  if (!needsQueryRewriting(query, conversationHistory)) {
    return query;
  }

  const endpoint = settings.chatEndpoint || settings.LiteLLMLink;
  if (!settings.selectedModel || !endpoint) {
    return query; // No LLM available, use original
  }

  try {
    // Build a minimal context with recent history (last 4 messages max for speed)
    const recentHistory = conversationHistory.slice(-4);
    const historyText = recentHistory
      .map(m => `${m.role}: ${m.content.slice(0, 200)}`) // truncate long messages
      .join('\n');

    const messages: ChatMessage[] = [
      { role: 'system', content: REWRITE_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Conversation history:\n${historyText}\n\nLatest user message to rewrite:\n${query}`,
      },
    ];

    const result = await queryLiteLLM(
      messages,
      settings.selectedModel,
      settings.apiKey,
      endpoint,
      signal,
      undefined, // no tools
      settings.chatProvider
    );

    const rewritten = result.choices?.[0]?.message?.content?.trim();

    // Sanity checks on the rewritten query
    if (!rewritten || rewritten.length === 0) return query;
    if (rewritten.length > query.length * 3) return query; // too verbose, reject
    if (rewritten.toLowerCase().startsWith('i ') || rewritten.toLowerCase().startsWith('the rewritten')) return query; // LLM is explaining, not rewriting

    console.info(`[queryRewriter] Original: "${query}" → Rewritten: "${rewritten}"`);
    return rewritten;
  } catch (err) {
    console.warn('[queryRewriter] Rewriting failed, using original query:', err);
    return query;
  }
}
