import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { mergeWithRRF, rerankWithRRF, SearchHit } from './reranker';

describe('rerankWithRRF', () => {
  const makeHit = (id: string, content: string, score: number): SearchHit => ({
    id,
    content,
    score,
  });

  // Requirement 4.6: Empty hits returns empty array
  it('returns empty array for empty hits', () => {
    expect(rerankWithRRF([], 'some query')).toEqual([]);
  });

  // Requirement 4.1: Keyword match score counts query terms in content
  it('computes keyword score as count of matching query terms', () => {
    const hits = [
      makeHit('1', 'the quick brown fox', 0.9),
      makeHit('2', 'lazy dog sleeps', 0.8),
    ];
    const result = rerankWithRRF(hits, 'quick fox', 60, 5);
    const hit1 = result.find((r) => r.id === '1')!;
    const hit2 = result.find((r) => r.id === '2')!;
    expect(hit1.keywordScore).toBe(2);
    expect(hit2.keywordScore).toBe(0);
  });

  // Requirement 4.4: Case-insensitive keyword matching
  it('performs case-insensitive keyword matching', () => {
    const hits = [makeHit('1', 'Hello World', 0.9)];
    const result = rerankWithRRF(hits, 'HELLO world', 60, 5);
    expect(result[0].keywordScore).toBe(2);
  });

  // Requirement 4.2: RRF formula combines vector and keyword ranks
  it('computes RRF score using the formula 1/(k+vectorRank) + 1/(k+keywordRank)', () => {
    const hits = [
      makeHit('1', 'alpha beta', 0.9),
      makeHit('2', 'gamma delta', 0.8),
    ];
    const result = rerankWithRRF(hits, 'alpha', 60, 5);

    // hit '1': vectorRank=1, keywordScore=1 → keywordRank=1
    // hit '2': vectorRank=2, keywordScore=0 → keywordRank=2
    const hit1 = result.find((r) => r.id === '1')!;
    expect(hit1.vectorRank).toBe(1);
    expect(hit1.keywordRank).toBe(1);
    expect(hit1.rrfScore).toBeCloseTo(1 / 61 + 1 / 61);

    const hit2 = result.find((r) => r.id === '2')!;
    expect(hit2.vectorRank).toBe(2);
    expect(hit2.keywordRank).toBe(2);
    expect(hit2.rrfScore).toBeCloseTo(1 / 62 + 1 / 62);
  });

  // Requirement 4.3: Results sorted by RRF score descending
  it('sorts results by RRF score descending', () => {
    // Hit 2 has lower vector rank but higher keyword match
    const hits = [
      makeHit('1', 'no match here', 0.95),
      makeHit('2', 'query term match', 0.85),
      makeHit('3', 'query term also match', 0.75),
    ];
    const result = rerankWithRRF(hits, 'query term match', 60, 5);
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].rrfScore).toBeGreaterThanOrEqual(result[i].rrfScore);
    }
  });

  // Requirement 4.5: Default limit of 5 results
  it('returns at most limit results (default 5)', () => {
    const hits = Array.from({ length: 10 }, (_, i) =>
      makeHit(`${i}`, `content ${i}`, 1 - i * 0.05)
    );
    const result = rerankWithRRF(hits, 'content');
    expect(result.length).toBe(5);
  });

  it('respects custom limit', () => {
    const hits = Array.from({ length: 10 }, (_, i) =>
      makeHit(`${i}`, `content ${i}`, 1 - i * 0.05)
    );
    const result = rerankWithRRF(hits, 'content', 60, 3);
    expect(result.length).toBe(3);
  });

  it('returns all hits when fewer than limit', () => {
    const hits = [
      makeHit('1', 'hello', 0.9),
      makeHit('2', 'world', 0.8),
    ];
    const result = rerankWithRRF(hits, 'hello world', 60, 5);
    expect(result.length).toBe(2);
  });

  // Keyword rank ties broken by original vector rank
  it('breaks keyword score ties by original vector rank', () => {
    const hits = [
      makeHit('1', 'same content here', 0.9),
      makeHit('2', 'same content here', 0.8),
    ];
    const result = rerankWithRRF(hits, 'same content', 60, 5);
    // Both have keywordScore=2, so keyword rank follows vector rank order
    const hit1 = result.find((r) => r.id === '1')!;
    const hit2 = result.find((r) => r.id === '2')!;
    expect(hit1.keywordRank).toBe(1);
    expect(hit2.keywordRank).toBe(2);
  });

  it('uses custom k value in RRF computation', () => {
    const hits = [makeHit('1', 'test content', 0.9)];
    const result = rerankWithRRF(hits, 'test', 10, 5);
    // vectorRank=1, keywordRank=1, k=10
    expect(result[0].rrfScore).toBeCloseTo(1 / 11 + 1 / 11);
  });

  it('handles query with extra whitespace', () => {
    const hits = [makeHit('1', 'hello world', 0.9)];
    const result = rerankWithRRF(hits, '  hello   world  ', 60, 5);
    expect(result[0].keywordScore).toBe(2);
  });

  it('handles single hit', () => {
    const hits = [makeHit('1', 'only result', 0.9)];
    const result = rerankWithRRF(hits, 'only', 60, 5);
    expect(result.length).toBe(1);
    expect(result[0].vectorRank).toBe(1);
    expect(result[0].keywordRank).toBe(1);
    expect(result[0].rrfScore).toBeCloseTo(1 / 61 + 1 / 61);
  });
});

describe('mergeWithRRF', () => {
  const makeHit = (id: string, content: string, score: number): SearchHit => ({
    id,
    content,
    score,
  });

  it('returns empty array when both lists are empty', () => {
    expect(mergeWithRRF([], [])).toEqual([]);
  });

  it('returns vector results with penalty BM25 ranks when BM25 list is empty', () => {
    const vectorHits = [
      makeHit('v1', 'vector result one', 0.9),
      makeHit('v2', 'vector result two', 0.8),
    ];
    const result = mergeWithRRF([], vectorHits);

    expect(result.length).toBe(2);
    // BM25 list is empty → penalty rank = 0 + 1 = 1
    const v1 = result.find((r) => r.id === 'v1')!;
    expect(v1.keywordRank).toBe(1); // penalty rank for empty BM25 list
    expect(v1.vectorRank).toBe(1);  // first in vector list

    const v2 = result.find((r) => r.id === 'v2')!;
    expect(v2.keywordRank).toBe(1); // penalty rank for empty BM25 list
    expect(v2.vectorRank).toBe(2);  // second in vector list
  });

  it('returns BM25 results with penalty vector ranks when vector list is empty', () => {
    const bm25Hits = [
      makeHit('b1', 'bm25 result one', 0.7),
      makeHit('b2', 'bm25 result two', 0.6),
    ];
    const result = mergeWithRRF(bm25Hits, []);

    expect(result.length).toBe(2);
    // Vector list is empty → penalty rank = 0 + 1 = 1
    const b1 = result.find((r) => r.id === 'b1')!;
    expect(b1.keywordRank).toBe(1); // first in BM25 list
    expect(b1.vectorRank).toBe(1);  // penalty rank for empty vector list

    const b2 = result.find((r) => r.id === 'b2')!;
    expect(b2.keywordRank).toBe(2); // second in BM25 list
    expect(b2.vectorRank).toBe(1);  // penalty rank for empty vector list
  });

  it('deduplicates overlapping IDs — each chunk appears only once', () => {
    const bm25Hits = [
      makeHit('shared', 'overlapping content', 0.7),
      makeHit('b-only', 'bm25 only', 0.5),
    ];
    const vectorHits = [
      makeHit('shared', 'overlapping content', 0.9),
      makeHit('v-only', 'vector only', 0.8),
    ];
    const result = mergeWithRRF(bm25Hits, vectorHits);

    const sharedResults = result.filter((r) => r.id === 'shared');
    expect(sharedResults.length).toBe(1);
    // Should use the higher score (0.9 from vector)
    expect(sharedResults[0].score).toBe(0.9);
    // Total unique IDs = 3
    expect(result.length).toBe(3);
  });

  it('applies custom bm25Weight and vectorWeight to RRF scores', () => {
    const bm25Hits = [makeHit('a', 'content a', 0.8)];
    const vectorHits = [makeHit('a', 'content a', 0.9)];
    const k = 60;

    // Default weights (1.0, 1.0)
    const defaultResult = mergeWithRRF(bm25Hits, vectorHits, { k });
    const defaultScore = defaultResult[0].rrfScore;
    expect(defaultScore).toBeCloseTo(1 / (k + 1) + 1 / (k + 1));

    // Custom weights: bm25Weight=2, vectorWeight=0.5
    const customResult = mergeWithRRF(bm25Hits, vectorHits, {
      k,
      bm25Weight: 2,
      vectorWeight: 0.5,
    });
    const customScore = customResult[0].rrfScore;
    expect(customScore).toBeCloseTo(2 * (1 / (k + 1)) + 0.5 * (1 / (k + 1)));
    expect(customScore).not.toBeCloseTo(defaultScore);
  });

  it('uses listLength + 1 as penalty rank when a chunk is in only one list', () => {
    const bm25Hits = [
      makeHit('b1', 'bm25 first', 0.9),
      makeHit('b2', 'bm25 second', 0.8),
      makeHit('b3', 'bm25 third', 0.7),
    ];
    const vectorHits = [
      makeHit('v1', 'vector first', 0.95),
    ];
    const k = 60;

    const result = mergeWithRRF(bm25Hits, vectorHits, { k, limit: 10 });

    // 'b1' is only in BM25 (rank 1). Missing from vector list of length 1 → penalty rank = 2
    const b1 = result.find((r) => r.id === 'b1')!;
    expect(b1.keywordRank).toBe(1);
    expect(b1.vectorRank).toBe(2); // vectorHits.length + 1 = 1 + 1 = 2
    expect(b1.rrfScore).toBeCloseTo(1 / (k + 1) + 1 / (k + 2));

    // 'v1' is only in vector (rank 1). Missing from BM25 list of length 3 → penalty rank = 4
    const v1 = result.find((r) => r.id === 'v1')!;
    expect(v1.keywordRank).toBe(4); // bm25Hits.length + 1 = 3 + 1 = 4
    expect(v1.vectorRank).toBe(1);
    expect(v1.rrfScore).toBeCloseTo(1 / (k + 4) + 1 / (k + 1));

    // 'b3' is only in BM25 (rank 3). Missing from vector list → penalty rank = 2
    const b3 = result.find((r) => r.id === 'b3')!;
    expect(b3.keywordRank).toBe(3);
    expect(b3.vectorRank).toBe(2); // vectorHits.length + 1 = 2
    expect(b3.rrfScore).toBeCloseTo(1 / (k + 3) + 1 / (k + 2));
  });
});

describe('Feature: hybrid-search, Property 6: RRF fused score correctness', () => {
  /**
   * Validates: Requirements 3.2, 3.3, 3.4
   *
   * For any two non-empty ranked lists and RRF constant K, each chunk's fused
   * score in the merged output should equal
   *   bm25Weight * 1/(K + rank_bm25) + vectorWeight * 1/(K + rank_vector)
   * where the rank in a missing list is listLength + 1.
   */

  // Arbitrary for a SearchHit with a given id
  const searchHitArb = (id: string): fc.Arbitrary<SearchHit> =>
    fc.record({
      id: fc.constant(id),
      content: fc.string({ minLength: 1 }),
      score: fc.double({ min: 0, max: 1, noNaN: true }),
    });

  // Generate a non-empty array of SearchHit with unique IDs within the list
  const uniqueHitListArb = (prefix: string): fc.Arbitrary<SearchHit[]> =>
    fc.integer({ min: 1, max: 10 }).chain((len) =>
      fc.tuple(
        ...Array.from({ length: len }, (_, i) => searchHitArb(`${prefix}${i}`))
      ).map((hits) => hits as SearchHit[])
    );

  it('each chunk fused score matches the RRF formula', () => {
    fc.assert(
      fc.property(
        uniqueHitListArb('b'),
        uniqueHitListArb('v'),
        fc.integer({ min: 1, max: 200 }),       // k
        fc.double({ min: 0.1, max: 5, noNaN: true }), // bm25Weight
        fc.double({ min: 0.1, max: 5, noNaN: true }), // vectorWeight
        (bm25Hits, vectorHits, k, bm25Weight, vectorWeight) => {
          const result = mergeWithRRF(bm25Hits, vectorHits, {
            k,
            bm25Weight,
            vectorWeight,
            limit: bm25Hits.length + vectorHits.length, // no limit truncation
          });

          // Build rank maps (1-indexed)
          const bm25RankMap = new Map<string, number>();
          bm25Hits.forEach((h, i) => bm25RankMap.set(h.id, i + 1));

          const vectorRankMap = new Map<string, number>();
          vectorHits.forEach((h, i) => vectorRankMap.set(h.id, i + 1));

          const bm25Penalty = bm25Hits.length + 1;
          const vectorPenalty = vectorHits.length + 1;

          for (const hit of result) {
            const rankBm25 = bm25RankMap.get(hit.id) ?? bm25Penalty;
            const rankVector = vectorRankMap.get(hit.id) ?? vectorPenalty;
            const expectedScore =
              bm25Weight * (1 / (k + rankBm25)) +
              vectorWeight * (1 / (k + rankVector));

            expect(hit.rrfScore).toBeCloseTo(expectedScore, 10);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Feature: hybrid-search, Property 7: RRF output is sorted and limited', () => {
  /**
   * Validates: Requirements 3.5
   *
   * For any two ranked lists and a specified limit, the merged output should be
   * sorted in descending order by fused score, and the output length should be
   * less than or equal to the limit.
   */

  const searchHitArb = (id: string): fc.Arbitrary<SearchHit> =>
    fc.record({
      id: fc.constant(id),
      content: fc.string({ minLength: 1 }),
      score: fc.double({ min: 0, max: 1, noNaN: true }),
    });

  const uniqueHitListArb = (prefix: string): fc.Arbitrary<SearchHit[]> =>
    fc.integer({ min: 0, max: 10 }).chain((len) => {
      if (len === 0) return fc.constant([] as SearchHit[]);
      return fc
        .tuple(...Array.from({ length: len }, (_, i) => searchHitArb(`${prefix}${i}`)))
        .map((hits) => hits as SearchHit[]);
    });

  it('output is sorted by rrfScore descending and length <= limit', () => {
    fc.assert(
      fc.property(
        uniqueHitListArb('b'),
        uniqueHitListArb('v'),
        fc.integer({ min: 1, max: 20 }), // limit
        fc.integer({ min: 1, max: 200 }), // k
        (bm25Hits, vectorHits, limit, k) => {
          const result = mergeWithRRF(bm25Hits, vectorHits, { k, limit });

          // Output length should be <= limit
          expect(result.length).toBeLessThanOrEqual(limit);

          // Output should be sorted by rrfScore descending
          for (let i = 1; i < result.length; i++) {
            expect(result[i - 1].rrfScore).toBeGreaterThanOrEqual(result[i].rrfScore);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Feature: hybrid-search, Property 8: RRF merger deduplicates by chunk ID', () => {
  /**
   * Validates: Requirements 6.2
   *
   * For any two ranked lists that share overlapping chunk IDs, the merged output
   * should contain each chunk ID at most once.
   */

  const searchHitArb = (id: string): fc.Arbitrary<SearchHit> =>
    fc.record({
      id: fc.constant(id),
      content: fc.string({ minLength: 1 }),
      score: fc.double({ min: 0, max: 1, noNaN: true }),
    });

  // Generate a list of SearchHit with unique IDs from a given pool of IDs
  const hitListFromIds = (ids: string[]): fc.Arbitrary<SearchHit[]> => {
    if (ids.length === 0) return fc.constant([] as SearchHit[]);
    return fc
      .tuple(...ids.map((id) => searchHitArb(id)))
      .map((hits) => hits as SearchHit[]);
  };

  it('each chunk ID appears at most once in the merged output', () => {
    fc.assert(
      fc.property(
        // Generate a pool of IDs, then split them into: shared, bm25-only, vector-only
        fc.integer({ min: 1, max: 5 }).chain((sharedCount) =>
          fc.integer({ min: 0, max: 5 }).chain((bm25OnlyCount) =>
            fc.integer({ min: 0, max: 5 }).chain((vectorOnlyCount) => {
              const sharedIds = Array.from({ length: sharedCount }, (_, i) => `shared-${i}`);
              const bm25OnlyIds = Array.from({ length: bm25OnlyCount }, (_, i) => `bm25-${i}`);
              const vectorOnlyIds = Array.from({ length: vectorOnlyCount }, (_, i) => `vec-${i}`);

              const bm25Ids = [...sharedIds, ...bm25OnlyIds];
              const vectorIds = [...sharedIds, ...vectorOnlyIds];

              return fc.tuple(
                hitListFromIds(bm25Ids),
                hitListFromIds(vectorIds),
                fc.integer({ min: 1, max: 200 }) // k
              );
            })
          )
        ),
        ([bm25Hits, vectorHits, k]) => {
          const limit = bm25Hits.length + vectorHits.length; // no truncation
          const result = mergeWithRRF(bm25Hits, vectorHits, { k, limit });

          // Collect all IDs from the result
          const ids = result.map((hit) => hit.id);
          const uniqueIds = new Set(ids);

          // Each chunk ID should appear at most once
          expect(ids.length).toBe(uniqueIds.size);
        }
      ),
      { numRuns: 100 }
    );
  });
});
