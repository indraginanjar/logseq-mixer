import type { RankedHit } from './reranker';
import { computeDepthWeight } from './hierarchyChunker';

/**
 * A search hit with depth-based weighting applied to its RRF score.
 */
export interface DepthWeightedHit extends RankedHit {
  depthWeight: number;
  weightedRrfScore: number;
}

/**
 * Apply depth-based weighting to RRF-merged search results.
 * Reads root_depth and has_heading from document metadata.
 *
 * For each hit, looks up its ID in the depthMetadata map to get rootDepth
 * and hasHeading, computes the depth weight via computeDepthWeight(), and
 * multiplies the hit's RRF score by the depth weight.
 *
 * Hits without depth metadata are treated as depth 0 (weight 1.0).
 */
export function applyDepthWeight(
  hits: RankedHit[],
  depthMetadata: Map<string, { rootDepth: number; hasHeading: boolean }>
): DepthWeightedHit[] {
  return hits.map((hit) => {
    const meta = depthMetadata.get(hit.id);
    const rootDepth = meta?.rootDepth ?? 0;
    const hasHeading = meta?.hasHeading ?? false;
    const depthWeight = computeDepthWeight(rootDepth, hasHeading);
    const weightedRrfScore = hit.rrfScore * depthWeight;

    return {
      ...hit,
      depthWeight,
      weightedRrfScore,
    };
  });
}
