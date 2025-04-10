import { create, insert, search } from '@orama/orama';
import { useGenerateEmbedding } from './useGenerateEmbedding';
// Define your schema for the documents you want to index


export async function checkIfVectorDBIndexed(embeddingsApiKey: string): Promise<boolean> {
  try {
    // Create an index (or connect to one if you have persistence)
    const oramaIndex = create({ 
      schema:{
        id: 'string',
        content: 'string',
        // If you have vector embeddings, you can store them as an array
        embedding: "vector[1536]"
      },
      id: "main-orama-db",
     });
    console.log('Orama index created:', oramaIndex);
    const newVector = await useGenerateEmbedding("This is a test note.",embeddingsApiKey);
    insert(oramaIndex, {
      content:"This is a test note.",
      embedding:newVector
    });
    const searchResult = search(oramaIndex, {
      mode: "vector",
      vector: {
        value: await useGenerateEmbedding("This is note.",embeddingsApiKey),
        property: "embedding",
      },
      similarity: 0.85, // Minimum similarity. Defaults to `0.8`
      limit: 10, // Defaults to `10`
      offset: 0,
    });
    console.log(searchResult);

    return true;
  } catch (error) {
    console.error('Error checking Orama index:', error);
    return false;
  }
}
