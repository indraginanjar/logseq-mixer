import { describe, test } from "vitest";
import fc from "fast-check";
import { computeDepthWeight } from "./hierarchyChunker";
import { applyDepthWeight } from "./depthWeightedSearch";
import type { RankedHit } from "./reranker";

describe("Property 9: Depth Weight Formula", () => {
  test("returns 1.0 for headings, max(1 - depth*0.1, 0.5) otherwise, always in [0.5, 1.0]", () => {
    fc.assert(
      fc.property(fc.nat(100), fc.boolean(), (depth, hasHeading) => {
        const w = computeDepthWeight(depth, hasHeading);
        if (hasHeading) return w === 1.0;
        const expected = Math.max(1.0 - depth * 0.1, 0.5);
        return w === expected && w >= 0.5 && w <= 1.0;
      }),
      { numRuns: 100 }
    );
  });
});

describe("Property 10: Consistent Depth Weighting", () => {
  test("weightedRrfScore === rrfScore * depthWeight for every hit", () => {
    const hitArb = fc.record({
      id: fc.uuid(),
      content: fc.string(),
      score: fc.float({ min: 0, max: 1, noNaN: true }),
      rrfScore: fc.float({ min: 0, max: 1, noNaN: true }),
      keywordScore: fc.float({ min: 0, max: 100, noNaN: true }),
      vectorRank: fc.nat(1000),
      keywordRank: fc.nat(1000),
    }) as fc.Arbitrary<RankedHit>;

    const metaArb = fc.record({
      rootDepth: fc.nat(20),
      hasHeading: fc.boolean(),
    });

    fc.assert(
      fc.property(
        fc.array(hitArb, { minLength: 1, maxLength: 10 }),
        fc.array(metaArb, { minLength: 1, maxLength: 10 }),
        (hits, metas) => {
          const depthMetadata = new Map<string, { rootDepth: number; hasHeading: boolean }>();
          hits.forEach((h, i) => depthMetadata.set(h.id, metas[i % metas.length]));

          const results = applyDepthWeight(hits, depthMetadata);

          return results.every((r) => {
            const expectedWeight = computeDepthWeight(
              depthMetadata.get(r.id)!.rootDepth,
              depthMetadata.get(r.id)!.hasHeading
            );
            return (
              r.depthWeight === expectedWeight &&
              Math.abs(r.weightedRrfScore - r.rrfScore * r.depthWeight) < 1e-10
            );
          });
        }
      ),
      { numRuns: 100 }
    );
  });
});
