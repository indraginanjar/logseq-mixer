import { describe, expect, it } from 'vitest';
import { rerankWithRRF, SearchHit } from './reranker';

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
