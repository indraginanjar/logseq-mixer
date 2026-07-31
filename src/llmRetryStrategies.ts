/**
 * Retry strategies for LLM API requests.
 * Each strategy detects a specific error condition and fixes the request body
 * to retry with corrected parameters.
 */

export interface RetryStrategy {
  shouldRetry: (status: number, errorBody: string, requestBody: Record<string, any>) => boolean;
  fix: (requestBody: Record<string, any>, errorBody: string, model: string, helpers: RetryHelpers) => void;
  log: (model: string) => void;
}

export interface RetryHelpers {
  getMaxTokensForModel: (model: string) => number;
  getContextLimitForModel: (model: string) => number;
}

/**
 * Set of model names (lowercased) that have been discovered at runtime to require
 * `max_completion_tokens` instead of `max_tokens`. Persists for the session so
 * the retry only happens once per model.
 */
export const modelsRequiringMaxCompletionTokens = new Set<string>();

const DEFAULT_MAX_TOKENS = 4096;

export const retryStrategies: RetryStrategy[] = [
  // Strategy 1: max_tokens → max_completion_tokens
  {
    shouldRetry: (status, errorBody, requestBody) =>
      status === 400 &&
      errorBody.includes('max_tokens') &&
      errorBody.includes('max_completion_tokens') &&
      'max_tokens' in requestBody,
    fix: (requestBody, _errorBody, model, helpers) => {
      modelsRequiringMaxCompletionTokens.add(model.toLowerCase());
      delete requestBody.max_tokens;
      requestBody.max_completion_tokens = helpers.getMaxTokensForModel(model);
    },
    log: (model) => {
      console.info(`[LLM Retry] Model "${model}" rejected max_tokens, retrying with max_completion_tokens.`);
    },
  },

  // Strategy 2: Remove reasoning_effort
  {
    shouldRetry: (status, errorBody, requestBody) =>
      status === 400 &&
      'reasoning_effort' in requestBody &&
      errorBody.includes('reasoning_effort'),
    fix: (requestBody) => {
      delete requestBody.reasoning_effort;
    },
    log: (model) => {
      console.info(`[LLM Retry] Model "${model}" rejected reasoning_effort, retrying without it.`);
    },
  },

  // Strategy 3: Reduce max tokens on context_length_exceeded
  {
    shouldRetry: (status, errorBody, requestBody) => {
      if (status !== 400 || !errorBody.includes('context_length_exceeded')) return false;
      const currentMaxTokens = requestBody.max_tokens || requestBody.max_completion_tokens || DEFAULT_MAX_TOKENS;
      // Only retry if we can actually reduce
      return currentMaxTokens > 512;
    },
    fix: (requestBody, _errorBody, model, helpers) => {
      const contextLimit = helpers.getContextLimitForModel(model);
      const currentMaxTokens = requestBody.max_tokens || requestBody.max_completion_tokens || DEFAULT_MAX_TOKENS;
      const reducedMaxTokens = Math.max(512, Math.floor(contextLimit * 0.4));
      if (reducedMaxTokens < currentMaxTokens) {
        if (requestBody.max_tokens) requestBody.max_tokens = reducedMaxTokens;
        if (requestBody.max_completion_tokens) requestBody.max_completion_tokens = reducedMaxTokens;
        console.info(`[LLM Retry] Reducing max_tokens from ${currentMaxTokens} to ${reducedMaxTokens}.`);
      }
    },
    log: (model) => {
      console.info(`[LLM Retry] Model "${model}" context_length_exceeded, reducing output tokens.`);
    },
  },
];
