
export async function useGenerateEmbedding(inputText: string,apiKey: string): Promise<number[]>{
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'text-embedding-ada-002',
      input: inputText,
    }),
  });
  
  const json = await res.json();
  return json.data[0].embedding;
}
