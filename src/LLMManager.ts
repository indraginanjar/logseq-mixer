
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
