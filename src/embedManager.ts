
export type VectorDBSchemaDynamic = {
  id: string;
  content: string;
  lastUpdated: number;
  embedding: number[]; // embedding as a number array
};

// text-embedding-ada-002 has an 8191 token limit.
// Using a conservative estimate to account for variable tokenization.
const MAX_INPUT_CHARS = 25000;

export async function useGenerateEmbedding(inputText: string, apiKey: string): Promise<number[]> {
  const truncatedText = inputText.length > MAX_INPUT_CHARS
    ? inputText.slice(0, MAX_INPUT_CHARS)
    : inputText;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'text-embedding-ada-002',
        input: truncatedText,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const json = await res.json();

    // Check if response is not OK or has an error
    if (!res.ok || json.error) {
      console.error('Embedding API error:', json.error);
      throw new Error(json.error?.message || 'Failed to generate embedding.');
    }

    return json.data[0].embedding;
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('Embedding API request timed out after 30 seconds');
    }
    throw err;
  }
}


export async function getEmbedingsAllNotes(apiKey: string,): Promise<VectorDBSchemaDynamic[]> {
  const BATCH_SIZE = 5;
  const pages = (await logseq.Editor.getAllPages()) ?? [];
  const allNotesEmbeddings: VectorDBSchemaDynamic[] = [];

  for (let i = 0; i < pages.length; i += BATCH_SIZE) {
    const batch = pages.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (page) => {
        const pagecontent = await logseq.Editor.getPageBlocksTree(page.uuid);
        let WholePageContent: string = "note_id: " + page.id + "\n" + "note_name: " + page.name + "\n" + "note_content: " + "\n" + "\n";
        for (const element of pagecontent) {
          WholePageContent = WholePageContent + "- " + element.content + "\n";
        }
        try {
          const MyNewEmbedding: VectorDBSchemaDynamic = {
            id: page.id.toString(),
            lastUpdated: page.updatedAt ?? 0,
            content: WholePageContent,
            embedding: await useGenerateEmbedding(WholePageContent, apiKey)
          };
          return MyNewEmbedding;
        } catch (err: any) {
          console.error('Embedding failed for page:', page.name, err);
          throw new Error(`Embedding failed for page "${page.name}": ${err.message || 'Unknown error. Verify your Embedding OpenAI API key in the settings.'}`);
        }
      })
    );
    allNotesEmbeddings.push(...batchResults);
  }

  return allNotesEmbeddings;
}
