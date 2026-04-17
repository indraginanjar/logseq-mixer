
export async function queryLiteLLM(
  query: string,
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
      messages: [{ role: 'user', content: query }],
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