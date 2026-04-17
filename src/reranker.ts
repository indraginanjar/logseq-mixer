export interface SearchHit {
  id: string;
  content: string;
  score: number; // original vector similarity score
}

export interface RankedHit extends SearchHit {
  rrfScore: number;
  keywordScore: number;
  vectorRank: number;
  keywordRank: number;
}

const RRF_K = 60;
const RESULT_LIMIT = 5;

/**
 * Rerank search hits using Reciprocal Rank Fusion.
 * Combines vector similarity rank with keyword match rank.
 *
 * @param hits - Vector search results (already sorted by similarity)
 * @param query - Original user query string
 * @param k - RRF constant (default 60)
 * @param limit - Max results to return (default 5)
 */
export function rerankWithRRF(
  hits: SearchHit[],
  query: string,
  k: number = RRF_K,
  limit: number = RESULT_LIMIT
): RankedHit[] {
  if (hits.length === 0) {
    return [];
  }

  // 1. Tokenize query into lowercase terms
  const queryTerms = query.toLowerCase().split(/\s+/).filter(Boolean);

  // 2. Compute keyword score per hit and assign vector rank (1-indexed)
  const scored = hits.map((hit, index) => {
    const contentLower = hit.content.toLowerCase();
    const keywordScore = queryTerms.reduce(
      (count, term) => count + (contentLower.includes(term) ? 1 : 0),
      0
    );
    return {
      ...hit,
      keywordScore,
      vectorRank: index + 1,
    };
  });

  // 3. Rank by keyword score descending, ties broken by original vector rank ascending
  const keywordSorted = [...scored].sort((a, b) => {
    if (b.keywordScore !== a.keywordScore) {
      return b.keywordScore - a.keywordScore;
    }
    return a.vectorRank - b.vectorRank;
  });

  // Assign keyword ranks (1-indexed)
  const withKeywordRank = keywordSorted.map((hit, index) => ({
    ...hit,
    keywordRank: index + 1,
  }));

  // 4. Compute RRF score
  const withRRF: RankedHit[] = withKeywordRank.map((hit) => ({
    ...hit,
    rrfScore: 1 / (k + hit.vectorRank) + 1 / (k + hit.keywordRank),
  }));

  // 5. Sort by RRF score descending, return top limit
  withRRF.sort((a, b) => b.rrfScore - a.rrfScore);

  return withRRF.slice(0, limit);
}

export interface MergeOptions {
  k?: number;           // RRF constant, default 60
  limit?: number;       // max results, default 5
  bm25Weight?: number;  // weight multiplier for BM25 ranks, default 1.0
  vectorWeight?: number; // weight multiplier for vector ranks, default 1.0
}

/**
 * Merge two independent ranked lists (BM25 + vector) using weighted Reciprocal Rank Fusion.
 *
 * Algorithm:
 * 1. Build a map of all unique chunk IDs from both lists
 * 2. For each chunk, determine its rank in each list (1-indexed)
 * 3. If a chunk appears in only one list, assign a penalty rank of listLength + 1
 * 4. Compute weighted RRF score: bm25Weight * 1/(k + rank_bm25) + vectorWeight * 1/(k + rank_vector)
 * 5. Sort by fused score descending, return top limit
 */
export function mergeWithRRF(
  bm25Hits: SearchHit[],
  vectorHits: SearchHit[],
  options?: MergeOptions
): RankedHit[] {
  const k = options?.k ?? RRF_K;
  const limit = options?.limit ?? RESULT_LIMIT;
  const bm25Weight = options?.bm25Weight ?? 1;
  const vectorWeight = options?.vectorWeight ?? 1;

  if (bm25Hits.length === 0 && vectorHits.length === 0) {
    return [];
  }

  // Build rank maps (1-indexed) for each list
  const bm25RankMap = new Map<string, number>();
  bm25Hits.forEach((hit, i) => {
    bm25RankMap.set(hit.id, i + 1);
  });

  const vectorRankMap = new Map<string, number>();
  vectorHits.forEach((hit, i) => {
    vectorRankMap.set(hit.id, i + 1);
  });

  // Penalty ranks for items missing from a list
  const bm25Penalty = bm25Hits.length + 1;
  const vectorPenalty = vectorHits.length + 1;

  // Collect all unique chunks, preferring the hit with the higher original score
  const chunkMap = new Map<string, SearchHit>();
  for (const hit of bm25Hits) {
    chunkMap.set(hit.id, hit);
  }
  for (const hit of vectorHits) {
    const existing = chunkMap.get(hit.id);
    if (!existing || hit.score > existing.score) {
      chunkMap.set(hit.id, hit);
    }
  }

  // Compute RRF scores for each unique chunk
  const results: RankedHit[] = [];
  for (const [id, hit] of chunkMap) {
    const rankBm25 = bm25RankMap.get(id) ?? bm25Penalty;
    const rankVector = vectorRankMap.get(id) ?? vectorPenalty;
    const rrfScore =
      bm25Weight * (1 / (k + rankBm25)) +
      vectorWeight * (1 / (k + rankVector));

    results.push({
      ...hit,
      rrfScore,
      keywordScore: bm25RankMap.has(id) ? 1 : 0,
      vectorRank: rankVector,
      keywordRank: rankBm25,
    });
  }

  // Sort by fused score descending
  results.sort((a, b) => b.rrfScore - a.rrfScore);

  return results.slice(0, limit);
}
