
export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

/** Max output tokens per model. Falls back to 4096 for unknown models. */
const MODEL_MAX_TOKENS: Record<string, number> = {
  'gpt-3.5-turbo': 4096,
  'gpt-4': 8192,
  'gpt-4o': 16384,
  'claude-2': 4096,
  'claude-3-opus': 4096,
  'gemini-pro': 8192,
  'codestral/codestral-latest': 8192,
  'deepseek-chat': 8192,
};

const DEFAULT_MAX_TOKENS = 4096;

export function getMaxTokensForModel(model: string): number {
  return MODEL_MAX_TOKENS[model] ?? DEFAULT_MAX_TOKENS;
}

const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  'gpt-3.5-turbo': 16385,
  'gpt-4': 8192,
  'gpt-4o': 128000,
  'claude-2': 100000,
  'claude-3-opus': 200000,
  'gemini-pro': 128000,
  'codestral/codestral-latest': 32000,
  'deepseek-chat': 64000,
};

export function getContextLimitForModel(model: string): number {
  const normalized = model.toLowerCase();
  if (MODEL_CONTEXT_LIMITS[model]) {
    return MODEL_CONTEXT_LIMITS[model];
  }
  // Keyword matching for unknown models
  if (normalized.includes('gpt-4o')) return 128000;
  if (normalized.includes('gpt-4')) return 8192;
  if (normalized.includes('gpt-3.5')) return 16385;
  if (normalized.includes('claude-3-5') || normalized.includes('claude-3.5')) return 200000;
  if (normalized.includes('claude-3')) return 200000;
  if (normalized.includes('gemini-1.5') || normalized.includes('gemini-pro')) return 128000;
  if (normalized.includes('llama-3') || normalized.includes('llama3')) return 8192;
  if (normalized.includes('mistral') || normalized.includes('mixtral')) return 32000;
  
  return 8192; // safe default fallback
}

export async function queryLiteLLM(
  messages: ChatMessage[],
  model: string,
  apiKey: string,
  endpoint: string,
  signal?: AbortSignal
): Promise<any> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model,
      messages: messages,
      max_tokens: getMaxTokensForModel(model),
      "api_key":apiKey
    }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`LiteLLM request failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data;
}
