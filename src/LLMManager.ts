
export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

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
