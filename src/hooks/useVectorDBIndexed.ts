import { create, insert, search } from '@orama/orama';
import { DEFAULT_EMBEDDING_MODEL, getDimensionsForModel, useGenerateEmbedding } from 'embedManager';
// Define your schema for the documents you want to index


export async function checkIfVectorDBIndexed(embeddingsApiKey: string, model: string = DEFAULT_EMBEDDING_MODEL): Promise<boolean> {
  try {
    // Create an index (or connect to one if you have persistence)
    const dimensions = getDimensionsForModel(model);
    const oramaIndex = create({ 
      schema:{
        id: 'string',
        content: 'string',
        // If you have vector embeddings, you can store them as an array
        embedding: `vector[${dimensions}]`
      },
      id: "main-orama-db",
     });
    console.log('Orama index created:', oramaIndex);
    const newVector = await useGenerateEmbedding("This is a test note.",embeddingsApiKey, model);
    insert(oramaIndex, {
      content:"This is a test note.",
      embedding:newVector
    });
    const searchResult = search(oramaIndex, {
      mode: "vector",
      vector: {
        value: await useGenerateEmbedding("This is note.",embeddingsApiKey, model),
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
