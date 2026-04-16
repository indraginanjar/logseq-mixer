import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { cosineSimilarity, decodeEmbedding, encodeEmbedding } from './cosineSimilarity';

describe('encodeEmbedding', () => {
  it('converts number[] to Uint8Array of correct length', () => {
    const embedding = [1.0, 2.0, 3.0];
    const encoded = encodeEmbedding(embedding);
    expect(encoded).toBeInstanceOf(Uint8Array);
    expect(encoded.byteLength).toBe(embedding.length * 4);
  });

  it('handles empty array', () => {
    const encoded = encodeEmbedding([]);
    expect(encoded.byteLength).toBe(0);
  });
});

describe('decodeEmbedding', () => {
  it('decodes Uint8Array back to Float32Array', () => {
    const original = [0.5, -1.25, 3.0];
    const encoded = encodeEmbedding(original);
    const decoded = decodeEmbedding(encoded);
    expect(decoded).toBeInstanceOf(Float32Array);
    expect(decoded.length).toBe(original.length);
    for (let i = 0; i < original.length; i++) {
      expect(decoded[i]).toBeCloseTo(original[i], 5);
    }
  });

  it('handles 1536-dimension embeddings', () => {
    const original = Array.from({ length: 1536 }, (_, i) => Math.sin(i));
    const decoded = decodeEmbedding(encodeEmbedding(original));
    expect(decoded.length).toBe(1536);
    for (let i = 0; i < original.length; i++) {
      expect(decoded[i]).toBeCloseTo(original[i], 5);
    }
  });

  it('handles 3072-dimension embeddings', () => {
    const original = Array.from({ length: 3072 }, (_, i) => Math.cos(i));
    const decoded = decodeEmbedding(encodeEmbedding(original));
    expect(decoded.length).toBe(3072);
  });
});

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    const v = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5);
  });

  it('returns -1 for opposite vectors', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([-1, 0, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 5);
  });

  it('returns 0 for orthogonal vectors', () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([0, 1]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5);
  });

  it('returns 0 when first vector is zero', () => {
    const a = new Float32Array([0, 0, 0]);
    const b = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it('returns 0 when second vector is zero', () => {
    const a = new Float32Array([1, 2, 3]);
    const b = new Float32Array([0, 0, 0]);
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it('returns 0 when both vectors are zero', () => {
    const a = new Float32Array([0, 0, 0]);
    const b = new Float32Array([0, 0, 0]);
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it('is scale-invariant', () => {
    const a = new Float32Array([1, 2, 3]);
    const b = new Float32Array([2, 4, 6]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5);
  });
});

// Feature: per-document-vector-storage, Property 1: Embedding BLOB round-trip
describe('Property 1: Embedding BLOB round-trip', () => {
  // **Validates: Requirements 1.3, 1.4, 11.1**
  it('encode then decode preserves all components within Float32 tolerance', () => {
    const embeddingArb = fc.oneof(
      fc.array(fc.double({ min: -1e38, max: 1e38, noNaN: true, noDefaultInfinity: true }), {
        minLength: 1536,
        maxLength: 1536,
      }),
      fc.array(fc.double({ min: -1e38, max: 1e38, noNaN: true, noDefaultInfinity: true }), {
        minLength: 3072,
        maxLength: 3072,
      })
    );

    fc.assert(
      fc.property(embeddingArb, (embedding) => {
        const encoded = encodeEmbedding(embedding);
        const decoded = decodeEmbedding(encoded);

        // Length must match
        expect(decoded.length).toBe(embedding.length);

        // BLOB byte length must be dimensions * 4
        expect(encoded.byteLength).toBe(embedding.length * 4);

        // Each component must equal the Float32-rounded original
        for (let i = 0; i < embedding.length; i++) {
          const expected = Math.fround(embedding[i]);
          expect(decoded[i]).toBe(expected);
        }
      }),
      { numRuns: 100 }
    );
  });
});

// Feature: per-document-vector-storage, Property 5: Cosine similarity range invariant
describe('Property 5: Cosine similarity range invariant', () => {
  // **Validates: Requirements 4.6**

  /**
   * Arbitrary that produces a Float32Array of the given length with finite,
   * non-zero values. We use double() constrained to a safe Float32 range,
   * then wrap in Float32Array so the values are true Float32 precision.
   */
  const float32ArrayArb = (len: number) =>
    fc
      .array(
        fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
        { minLength: len, maxLength: len }
      )
      .map((arr) => new Float32Array(arr));

  const dimensionArb = fc.constantFrom(1536, 3072);

  it('cosineSimilarity returns a value in [-1, 1] for random non-zero vector pairs', () => {
    fc.assert(
      fc.property(
        dimensionArb.chain((dim) => fc.tuple(float32ArrayArb(dim), float32ArrayArb(dim))),
        ([a, b]) => {
          const sim = cosineSimilarity(a, b);
          expect(sim).toBeGreaterThanOrEqual(-1);
          expect(sim).toBeLessThanOrEqual(1);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('cosineSimilarity returns 0 when first vector is all zeros', () => {
    fc.assert(
      fc.property(
        dimensionArb.chain((dim) =>
          float32ArrayArb(dim).map((b) => [new Float32Array(dim), b] as const)
        ),
        ([zeroVec, b]) => {
          expect(cosineSimilarity(zeroVec, b)).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('cosineSimilarity returns 0 when second vector is all zeros', () => {
    fc.assert(
      fc.property(
        dimensionArb.chain((dim) =>
          float32ArrayArb(dim).map((a) => [a, new Float32Array(dim)] as const)
        ),
        ([a, zeroVec]) => {
          expect(cosineSimilarity(a, zeroVec)).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('cosineSimilarity returns 0 when both vectors are all zeros', () => {
    fc.assert(
      fc.property(dimensionArb, (dim) => {
        const z = new Float32Array(dim);
        expect(cosineSimilarity(z, z)).toBe(0);
      }),
      { numRuns: 100 }
    );
  });
});
