import { DEFAULT_EMBEDDING_MODEL, useGenerateEmbedding } from 'embedManager';

/**
 * Check if the vector DB is functional by generating a test embedding.
 * This validates that the embedding provider is configured correctly.
 */
export async function checkIfVectorDBIndexed(embeddingsApiKey: string, model: string = DEFAULT_EMBEDDING_MODEL): Promise<boolean> {
  try {
    const newVector = await useGenerateEmbedding("This is a test note.", embeddingsApiKey, model);
    console.log('Embedding generation test succeeded, vector length:', newVector.length);
    return true;
  } catch (error) {
    console.error('Error checking vector DB:', error);
    return false;
  }
}
