/**
 * Encode a number[] embedding to a Uint8Array (Float32Array raw bytes, little-endian).
 */
export function encodeEmbedding(embedding: number[]): Uint8Array {
  const f32 = new Float32Array(embedding);
  return new Uint8Array(f32.buffer);
}

/**
 * Decode a Uint8Array BLOB back to a Float32Array.
 */
export function decodeEmbedding(blob: Uint8Array): Float32Array {
  // Ensure proper alignment by copying into a new ArrayBuffer
  const buffer = new ArrayBuffer(blob.byteLength);
  new Uint8Array(buffer).set(blob);
  return new Float32Array(buffer);
}

/**
 * Compute cosine similarity between two vectors.
 * Returns a value in [-1, 1]. Handles zero-magnitude vectors by returning 0.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  if (denom === 0) return 0;
  return dot / denom;
}
