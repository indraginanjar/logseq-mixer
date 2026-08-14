import { getTokenUsageStore } from './tokenUsageInstance';
import { countTokens } from '../tokenizer';
import { getActiveAgentId } from '../agents/AgentConfigStore';

/** Accumulated token usage for the current query (reset per handleQuery call). */
let _queryPromptTokens = 0;
let _queryCompletionTokens = 0;

/** Reset the per-query accumulator. Call at the start of each handleQuery. */
export function resetQueryTokenAccumulator(): void {
  _queryPromptTokens = 0;
  _queryCompletionTokens = 0;
}

/** Get the accumulated token counts for the current query. */
export function getQueryTokenUsage(): { promptTokens: number; completionTokens: number } {
  return { promptTokens: _queryPromptTokens, completionTokens: _queryCompletionTokens };
}

/**
 * Log token usage from an LLM API response.
 * Also accumulates into the per-query counters.
 * If the API response doesn't include usage data, optionally estimates from
 * the messages and response content using the local tokenizer.
 */
export function logTokenUsage(response: any, model: string, provider: string, messages?: any[], responseContent?: string): void {
  const usage = response?.usage;
  let prompt_tokens: number | undefined;
  let completion_tokens: number | undefined;

  if (usage && typeof usage.prompt_tokens === 'number' && typeof usage.completion_tokens === 'number') {
    prompt_tokens = usage.prompt_tokens;
    completion_tokens = usage.completion_tokens;
  } else if (messages || responseContent) {
    // Fallback: estimate tokens locally
    try {
      if (messages) {
        prompt_tokens = 0;
        for (const m of messages) {
          if (typeof m.content === 'string') prompt_tokens += countTokens(m.content);
          else if (Array.isArray(m.content)) {
            for (const part of m.content) {
              if (part.type === 'text') prompt_tokens += countTokens(part.text);
            }
          }
        }
      }
      if (responseContent) {
        completion_tokens = countTokens(responseContent);
      } else {
        const content = response?.choices?.[0]?.message?.content;
        if (content) completion_tokens = countTokens(content);
      }
    } catch {
      // Tokenizer not available, skip
      return;
    }
  }

  if (prompt_tokens == null && completion_tokens == null) return;

  // Accumulate for per-message display
  _queryPromptTokens += prompt_tokens || 0;
  _queryCompletionTokens += completion_tokens || 0;

  // Persist to store
  const store = getTokenUsageStore();
  if (!store) return;
  try {
    const agentId = getActiveAgentId() || 'default';
    store.logUsage(model, provider, prompt_tokens || 0, completion_tokens || 0, agentId);
  } catch (err) {
    console.warn('[TokenUsage] Failed to log usage:', err);
  }
}
