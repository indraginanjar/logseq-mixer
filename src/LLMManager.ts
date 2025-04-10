
export async function queryLiteLLM(
  query: string,
  model: string,
  apiKey: string,
  endpoint: string
): Promise<any> {
  // Adjust this URL to match your LiteLLM server endpoint.
  //const endpoint = 'http://localhost:4000/chat/completions';

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model, // Use the model from settings
      messages: [{ role: 'user', content: query }],
      "api_key":apiKey
      
    }),
  });

  if (!response.ok) {
    throw new Error(`LiteLLM request failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data;
}