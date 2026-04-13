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
