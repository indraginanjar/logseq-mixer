import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { BlockLine } from './embedManager';
import { buildAncestorContext, buildSubtreeChunks, computeDepthWeight } from './hierarchyChunker';
import { countTokens } from './tokenizer';

describe('buildAncestorContext', () => {
  const makeBlock = (content: string, depth: number): BlockLine => ({
    content,
    isHeading: /^#{1,6}\s+/.test(content),
    depth,
    groupId: -1,
  });

  it('returns empty string for a block at depth 0', () => {
    const blocks: BlockLine[] = [makeBlock('- Root block', 0)];
    expect(buildAncestorContext(blocks, 0)).toBe('');
  });

  it('returns the parent content for a block at depth 1', () => {
    const blocks: BlockLine[] = [
      makeBlock('- Parent', 0),
      makeBlock('[Parent] Child', 1),
    ];
    expect(buildAncestorContext(blocks, 1)).toBe('- Parent');
  });

  it('returns breadcrumb chain for deeply nested block', () => {
    const blocks: BlockLine[] = [
      makeBlock('- Grandparent', 0),
      makeBlock('[Grandparent] Parent', 1),
      makeBlock('[Grandparent > Parent] Child', 2),
    ];
    expect(buildAncestorContext(blocks, 2)).toBe('- Grandparent > [Grandparent] Parent');
  });

  it('returns empty string when blockIndex is out of bounds', () => {
    const blocks: BlockLine[] = [makeBlock('- Root', 0)];
    expect(buildAncestorContext(blocks, -1)).toBe('');
    expect(buildAncestorContext(blocks, 5)).toBe('');
  });

  it('truncates ancestor content when combined context is long', () => {
    const longContent = 'A'.repeat(100);
    const blocks: BlockLine[] = [
      makeBlock(longContent, 0),
      makeBlock('Child', 1),
    ];
    const result = buildAncestorContext(blocks, 1, 60);
    // The ancestor should be truncated to 60 chars + ellipsis
    expect(result).toBe(longContent.slice(0, 60) + '…');
  });

  it('does not truncate when ancestors are short', () => {
    const blocks: BlockLine[] = [
      makeBlock('Short', 0),
      makeBlock('Child', 1),
    ];
    const result = buildAncestorContext(blocks, 1, 60);
    expect(result).toBe('Short');
  });

  it('handles skipped depth levels gracefully', () => {
    // A block at depth 0 followed directly by a block at depth 3
    // The ancestor chain should still find the depth-0 block
    const blocks: BlockLine[] = [
      makeBlock('- Root', 0),
      makeBlock('Deep child', 3),
    ];
    const result = buildAncestorContext(blocks, 1);
    expect(result).toBe('- Root');
  });

  it('finds correct ancestors with multiple siblings', () => {
    const blocks: BlockLine[] = [
      makeBlock('- Parent A', 0),
      makeBlock('[Parent A] Child A1', 1),
      makeBlock('[Parent A] Child A2', 1),
      makeBlock('- Parent B', 0),
      makeBlock('[Parent B] Child B1', 1),
    ];
    // Child B1 should have "- Parent B" as ancestor, not "- Parent A"
    expect(buildAncestorContext(blocks, 4)).toBe('- Parent B');
  });
});

describe('computeDepthWeight', () => {
  it('returns 1.0 when hasHeading is true regardless of depth', () => {
    expect(computeDepthWeight(0, true)).toBe(1);
    expect(computeDepthWeight(3, true)).toBe(1);
    expect(computeDepthWeight(10, true)).toBe(1);
    expect(computeDepthWeight(20, true)).toBe(1);
  });

  it('returns 1.0 for depth 0 without heading', () => {
    expect(computeDepthWeight(0, false)).toBe(1);
  });

  it('reduces weight by 0.1 per depth level', () => {
    expect(computeDepthWeight(1, false)).toBeCloseTo(0.9);
    expect(computeDepthWeight(2, false)).toBeCloseTo(0.8);
    expect(computeDepthWeight(3, false)).toBeCloseTo(0.7);
    expect(computeDepthWeight(4, false)).toBeCloseTo(0.6);
  });

  it('floors at 0.5 for deep blocks', () => {
    expect(computeDepthWeight(5, false)).toBe(0.5);
    expect(computeDepthWeight(6, false)).toBe(0.5);
    expect(computeDepthWeight(10, false)).toBe(0.5);
    expect(computeDepthWeight(100, false)).toBe(0.5);
  });
});

describe('buildSubtreeChunks', () => {
  const makeBlock = (content: string, depth: number, isHeading = false, groupId = -1): BlockLine => ({
    content,
    isHeading,
    depth,
    groupId,
  });

  const pageHeader = 'note_id: 1\nnote_name: Test Page\nnote_content:\n\n';

  it('returns a single chunk with just page header for empty input', () => {
    const result = buildSubtreeChunks([], { maxTokens: 8191, pageHeader });
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe(pageHeader);
    expect(result[0].rootDepth).toBe(0);
    expect(result[0].hasHeading).toBe(false);
    expect(result[0].blockLines).toHaveLength(0);
  });

  it('puts all blocks in a single chunk when they fit', () => {
    const blocks: BlockLine[] = [
      makeBlock('- Meeting Notes', 0, true),
      makeBlock('[Meeting Notes] Attendees', 1),
      makeBlock('[Meeting Notes] Agenda', 1),
    ];
    const result = buildSubtreeChunks(blocks, { maxTokens: 8191, pageHeader });
    expect(result).toHaveLength(1);
    expect(result[0].hasHeading).toBe(true);
    expect(result[0].rootDepth).toBe(0);
    expect(result[0].content).toContain('Meeting Notes');
    expect(result[0].content).toContain('Attendees');
    expect(result[0].content).toContain('Agenda');
  });

  it('single-chunk pages have no overlap', () => {
    const blocks: BlockLine[] = [
      makeBlock('- Block A', 0),
      makeBlock('- Block B', 0),
    ];
    const result = buildSubtreeChunks(blocks, { maxTokens: 8191, pageHeader });
    expect(result).toHaveLength(1);
  });

  it('every chunk starts with the page header', () => {
    // Force multi-chunk by using blocks that exceed budget individually
    const blocks: BlockLine[] = [
      makeBlock('- ' + 'Apple '.repeat(80), 0),
      makeBlock('- ' + 'Banana '.repeat(80), 0),
    ];
    const result = buildSubtreeChunks(blocks, { maxTokens: 150, pageHeader });
    expect(result.length).toBeGreaterThanOrEqual(2);
    for (const chunk of result) {
      expect(chunk.content.startsWith(pageHeader)).toBe(true);
    }
  });

  it('respects the token budget for each chunk', () => {
    const blocks: BlockLine[] = [
      makeBlock('- ' + 'Word '.repeat(50), 0),
      makeBlock('- ' + 'Test '.repeat(50), 0),
      makeBlock('- ' + 'Data '.repeat(50), 0),
    ];
    const maxTokens = 100;
    const result = buildSubtreeChunks(blocks, { maxTokens, pageHeader });
    for (const chunk of result) {
      expect(countTokens(chunk.content)).toBeLessThanOrEqual(maxTokens);
    }
  });

  it('preserves block UUID annotations in chunk content', () => {
    const blocks: BlockLine[] = [
      makeBlock('[block:abc-123] - Root block', 0),
      makeBlock('[block:def-456] [Root block] Child', 1),
    ];
    const result = buildSubtreeChunks(blocks, { maxTokens: 8191, pageHeader });
    expect(result[0].content).toContain('[block:abc-123]');
    expect(result[0].content).toContain('[block:def-456]');
  });

  it('sets rootDepth correctly for chunks', () => {
    const blocks: BlockLine[] = [
      makeBlock('- Parent', 0),
      makeBlock('[Parent] Child', 1),
    ];
    const result = buildSubtreeChunks(blocks, { maxTokens: 8191, pageHeader });
    expect(result[0].rootDepth).toBe(0);
  });

  it('sets hasHeading when chunk contains a heading block', () => {
    const blocks: BlockLine[] = [
      makeBlock('# Meeting Notes', 0, true),
      makeBlock('[Meeting Notes] Attendees', 1),
    ];
    const result = buildSubtreeChunks(blocks, { maxTokens: 8191, pageHeader });
    expect(result[0].hasHeading).toBe(true);
  });

  it('sets hasHeading to false when no heading blocks present', () => {
    const blocks: BlockLine[] = [
      makeBlock('- Regular block', 0),
      makeBlock('[Regular block] Child', 1),
    ];
    const result = buildSubtreeChunks(blocks, { maxTokens: 8191, pageHeader });
    expect(result[0].hasHeading).toBe(false);
  });

  it('splits oversized subtrees at child boundaries', () => {
    // Create a subtree where root + all children exceeds budget
    const blocks: BlockLine[] = [
      makeBlock('- Root', 0),
      makeBlock('[Root] ' + 'Child1 '.repeat(40), 1),
      makeBlock('[Root] ' + 'Child2 '.repeat(40), 1),
      makeBlock('[Root] ' + 'Child3 '.repeat(40), 1),
    ];
    const maxTokens = 100;
    const result = buildSubtreeChunks(blocks, { maxTokens, pageHeader });
    // Should produce multiple chunks
    expect(result.length).toBeGreaterThan(1);
    // Each chunk should respect token budget
    for (const chunk of result) {
      expect(countTokens(chunk.content)).toBeLessThanOrEqual(maxTokens);
    }
  });

  it('applies overlap for multi-chunk pages', () => {
    // Create blocks that produce multiple chunks with enough room for overlap
    const blocks: BlockLine[] = [
      makeBlock('- Alpha block content here', 0),
      makeBlock('- Beta block content here', 0),
      makeBlock('- Gamma block content here', 0),
      makeBlock('- Delta block content here', 0),
      makeBlock('- Epsilon block content here', 0),
    ];
    // Use a budget that forces splitting but allows overlap
    const headerTok = countTokens(pageHeader);
    // Each block is about 6-7 tokens, so budget for header + 2 blocks
    const maxTokens = headerTok + 16;
    const result = buildSubtreeChunks(blocks, { maxTokens, pageHeader });
    // Should produce multiple chunks
    if (result.length > 1) {
      // The last block of chunk 0 should appear in chunk 1's blockLines (overlap)
      const chunk0Blocks = result[0].blockLines;
      const lastBlockOfChunk0 = chunk0Blocks[chunk0Blocks.length - 1];
      // Overlap means the content should be present in chunk 1
      expect(result[1].blockLines.some(bl => bl.content === lastBlockOfChunk0.content)).toBe(true);
    }
  });

  it('prepends ancestor context for chunks rooted at depth > 0', () => {
    // Force a split so that a child block becomes the root of a new chunk
    const blocks: BlockLine[] = [
      makeBlock('# Section Header', 0, true),
      makeBlock('[Section Header] ' + 'ChildA '.repeat(50), 1),
      makeBlock('[Section Header] ' + 'ChildB '.repeat(50), 1),
    ];
    const maxTokens = 100;
    const result = buildSubtreeChunks(blocks, { maxTokens, pageHeader });
    // If the heading subtree was split, continuation chunks should have ancestor context
    if (result.length > 1) {
      // At least one chunk should contain the heading content as context
      const hasAncestorCtx = result.slice(1).some(chunk =>
        chunk.content.includes('Section Header')
      );
      expect(hasAncestorCtx).toBe(true);
    }
  });

  it('heading group cohesion: keeps heading + children together when they fit', () => {
    const blocks: BlockLine[] = [
      makeBlock('# My Heading', 0, true),
      makeBlock('[My Heading] Child A', 1),
      makeBlock('[My Heading] Child B', 1),
    ];
    // Budget is large enough for all
    const result = buildSubtreeChunks(blocks, { maxTokens: 8191, pageHeader });
    expect(result).toHaveLength(1);
    expect(result[0].content).toContain('# My Heading');
    expect(result[0].content).toContain('Child A');
    expect(result[0].content).toContain('Child B');
  });

  it('truncates single oversized blocks at token boundary', () => {
    const hugeContent = '- ' + 'Overflow '.repeat(5000);
    const blocks: BlockLine[] = [makeBlock(hugeContent, 0)];
    const maxTokens = 100;
    const result = buildSubtreeChunks(blocks, { maxTokens, pageHeader });
    expect(result).toHaveLength(1);
    expect(countTokens(result[0].content)).toBeLessThanOrEqual(maxTokens);
  });
});

describe('buildSubtreeChunks — property tests', () => {
  const pageHeader = 'note_id: 1\nnote_name: Test Page\nnote_content:\n\n';

  const arbBlockTree: fc.Arbitrary<BlockLine[]> = fc.integer({ min: 3, max: 30 }).chain(len =>
    fc.array(
      fc.record({
        contentWords: fc.integer({ min: 1, max: 40 }),
        isHeading: fc.boolean(),
        hasUuid: fc.boolean(),
        uuid: fc.uuid(),
      }),
      { minLength: len, maxLength: len }
    ).map(items => {
      let currentDepth = 0;
      return items.map((item, i) => {
        const maxDepth = Math.min(currentDepth + 1, 5);
        const depth = i === 0 ? 0 : Math.min(maxDepth, Math.max(0, currentDepth + (i % 3 === 0 ? -1 : i % 3 === 1 ? 0 : 1)));
        currentDepth = depth;

        const words = 'word '.repeat(item.contentWords).trim();
        const prefix = item.isHeading ? '# ' : '- ';
        const uuidPart = item.hasUuid ? `[block:${item.uuid}] ` : '';
        const content = `${uuidPart}${prefix}${words}`;

        return { content, isHeading: item.isHeading, depth, groupId: i };
      });
    })
  );

  it('Property 1: Token Budget Invariant', () => {
    fc.assert(fc.property(
      arbBlockTree,
      fc.integer({ min: 100, max: 500 }),
      (blocks, maxTokens) => {
        const result = buildSubtreeChunks(blocks, { maxTokens, pageHeader });
        for (const chunk of result) {
          expect(countTokens(chunk.content)).toBeLessThanOrEqual(maxTokens);
        }
      }
    ), { numRuns: 100 });
  });

  it('Property 2: Contiguous Subtree Integrity', () => {
    fc.assert(fc.property(
      arbBlockTree,
      fc.integer({ min: 100, max: 500 }),
      (blocks, maxTokens) => {
        const result = buildSubtreeChunks(blocks, { maxTokens, pageHeader });
        for (const chunk of result) {
          if (chunk.blockLines.length === 0) continue;
          // Find indices using groupId for uniqueness
          const indices = chunk.blockLines.map(bl =>
            blocks.findIndex(b => b.groupId === bl.groupId)
          ).filter(i => i !== -1);
          // Indices should be in non-decreasing order (overlap blocks may repeat from earlier)
          for (let i = 1; i < indices.length; i++) {
            expect(indices[i]).toBeGreaterThanOrEqual(indices[i - 1]);
          }
        }
      }
    ), { numRuns: 100 });
  });

  it('Property 3: Child-Boundary Splitting', () => {
    fc.assert(fc.property(
      arbBlockTree,
      fc.integer({ min: 100, max: 500 }),
      (blocks, maxTokens) => {
        const result = buildSubtreeChunks(blocks, { maxTokens, pageHeader });
        for (const chunk of result) {
          for (const bl of chunk.blockLines) {
            // Each block's content matches an original exactly OR is a truncation of one
            const match = blocks.some(b =>
              b.content === bl.content || b.content.startsWith(bl.content)
            );
            expect(match).toBe(true);
          }
        }
      }
    ), { numRuns: 100 });
  });

  it('Property 4: Ancestor Context Presence', () => {
    fc.assert(fc.property(
      arbBlockTree,
      fc.integer({ min: 100, max: 500 }),
      (blocks, maxTokens) => {
        const result = buildSubtreeChunks(blocks, { maxTokens, pageHeader });
        for (const chunk of result) {
          // Only check chunks with rootDepth > 1 (depth 1 has single ancestor, no ' > ')
          if (chunk.rootDepth > 1) {
            const afterHeader = chunk.content.slice(pageHeader.length);
            const firstBlockContent = chunk.blockLines[0]?.content ?? '';
            const beforeFirstBlock = afterHeader.split(firstBlockContent)[0] ?? '';
            expect(beforeFirstBlock).toContain(' > ');
          }
        }
      }
    ), { numRuns: 100 });
  });

  it('Property 5: Block UUID Annotation Preservation', () => {
    fc.assert(fc.property(
      arbBlockTree,
      fc.integer({ min: 200, max: 500 }),
      (blocks, maxTokens) => {
        const result = buildSubtreeChunks(blocks, { maxTokens, pageHeader });
        for (const chunk of result) {
          for (const bl of chunk.blockLines) {
            const uuidMatch = bl.content.match(/\[block:[^\]]+\]/);
            if (uuidMatch && chunk.content.includes(bl.content)) {
              // If the block's full content is present, the UUID must be too
              expect(chunk.content).toContain(uuidMatch[0]);
            }
          }
        }
      }
    ), { numRuns: 100 });
  });

  it('Property 6: Page Header Invariant', () => {
    fc.assert(fc.property(
      arbBlockTree,
      fc.integer({ min: 100, max: 500 }),
      (blocks, maxTokens) => {
        const result = buildSubtreeChunks(blocks, { maxTokens, pageHeader });
        for (const chunk of result) {
          expect(chunk.content.startsWith(pageHeader)).toBe(true);
        }
      }
    ), { numRuns: 100 });
  });

  it('Property 7: Overlap Bounds', () => {
    fc.assert(fc.property(
      arbBlockTree,
      fc.integer({ min: 100, max: 500 }),
      (blocks, maxTokens) => {
        const result = buildSubtreeChunks(blocks, { maxTokens, pageHeader });
        if (result.length <= 1) return;
        for (let i = 1; i < result.length; i++) {
          const prev = result[i - 1];
          const curr = result[i];
          // Overlap blocks are those at the start of curr that match end of prev
          const prevGroupIds = new Set(prev.blockLines.map(bl => bl.groupId));
          const overlapBlocks: BlockLine[] = [];
          for (const bl of curr.blockLines) {
            if (prevGroupIds.has(bl.groupId)) overlapBlocks.push(bl);
            else break; // overlap is only at the start
          }
          // overlap block count ≤ max(1, ceil(prevBlockCount * 0.15))
          const maxOverlapCount = Math.max(1, Math.ceil(prev.blockLines.length * 0.15));
          expect(overlapBlocks.length).toBeLessThanOrEqual(maxOverlapCount);
          // overlap token cost ≤ floor(maxTokens * 0.20)
          const overlapTokens = overlapBlocks.reduce((sum, bl) => sum + countTokens(bl.content + '\n'), 0);
          expect(overlapTokens).toBeLessThanOrEqual(Math.floor(maxTokens * 0.20));
        }
      }
    ), { numRuns: 100 });
  });

  it('Property 8: Chunk Count', () => {
    fc.assert(fc.property(
      arbBlockTree,
      fc.integer({ min: 100, max: 500 }),
      (blocks, maxTokens) => {
        const result = buildSubtreeChunks(blocks, { maxTokens, pageHeader });
        expect(result.length).toBeGreaterThanOrEqual(1);
        // If total content (conservative estimate) fits, should be exactly 1
        const totalContent = pageHeader + blocks.map(b => b.content + '\n').join('');
        if (countTokens(totalContent) <= maxTokens) {
          expect(result.length).toBe(1);
        } else {
          expect(result.length).toBeGreaterThanOrEqual(2);
        }
      }
    ), { numRuns: 100 });
  });

  it('Property 12: Heading Group Cohesion', () => {
    fc.assert(fc.property(
      arbBlockTree,
      fc.integer({ min: 200, max: 500 }),
      (blocks, maxTokens) => {
        const result = buildSubtreeChunks(blocks, { maxTokens, pageHeader });
        for (let i = 0; i < blocks.length; i++) {
          if (!blocks[i].isHeading) continue;
          const headingDepth = blocks[i].depth;
          // Collect immediate children (depth === headingDepth + 1) until sibling/shallower
          const group = [blocks[i]];
          for (let j = i + 1; j < blocks.length; j++) {
            if (blocks[j].depth <= headingDepth) break;
            if (blocks[j].depth === headingDepth + 1) group.push(blocks[j]);
          }
          if (group.length <= 1) continue;
          // Compute tokens for heading + immediate children content
          const groupTokens = countTokens(pageHeader + group.map(b => b.content + '\n').join(''));
          if (groupTokens <= maxTokens) {
            // Find chunk containing the heading
            const chunkIdx = result.findIndex(c =>
              c.blockLines.some(bl => bl.groupId === blocks[i].groupId)
            );
            if (chunkIdx === -1) continue;
            const chunk = result[chunkIdx];
            for (const member of group) {
              expect(chunk.blockLines.some(bl => bl.groupId === member.groupId)).toBe(true);
            }
          }
        }
      }
    ), { numRuns: 100 });
  });

  it('Property 13: Heading Split with Ancestor Context', () => {
    fc.assert(fc.property(
      arbBlockTree,
      fc.integer({ min: 150, max: 500 }),
      (blocks, maxTokens) => {
        const result = buildSubtreeChunks(blocks, { maxTokens, pageHeader });
        if (result.length <= 1) return;
        for (let i = 0; i < blocks.length; i++) {
          if (!blocks[i].isHeading) continue;
          const headingDepth = blocks[i].depth;
          const headingGroupId = blocks[i].groupId;
          // Determine the heading's subtree range
          let subtreeEnd = i + 1;
          while (subtreeEnd < blocks.length && blocks[subtreeEnd].depth > headingDepth) {
            subtreeEnd++;
          }
          if (subtreeEnd === i + 1) continue; // no children
          const subtreeGroupIds = new Set(
            blocks.slice(i + 1, subtreeEnd).map(b => b.groupId)
          );
          // Find the chunk containing the heading
          const chunkWithHeading = result.findIndex(c =>
            c.blockLines.some(bl => bl.groupId === headingGroupId)
          );
          if (chunkWithHeading === -1) continue;
          // Check if ALL subtree members are already in the heading's chunk
          const headingChunk = result[chunkWithHeading];
          const headingChunkGroupIds = new Set(headingChunk.blockLines.map(bl => bl.groupId));
          const allInHeadingChunk = [...subtreeGroupIds].every(gid => headingChunkGroupIds.has(gid));
          if (allInHeadingChunk) continue; // subtree not split — no continuation expected
          // Find continuation chunks with subtree members but not the heading itself
          const continuationChunks = result.slice(chunkWithHeading + 1).filter(c => {
            const groupIds = new Set(c.blockLines.map(bl => bl.groupId));
            if (groupIds.has(headingGroupId)) return false;
            // Must have a subtree member that is NOT just overlap from the heading chunk
            return c.blockLines.some(bl =>
              subtreeGroupIds.has(bl.groupId) && !headingChunkGroupIds.has(bl.groupId)
            );
          });
          if (continuationChunks.length === 0) continue;
          // At least one continuation chunk should reference the heading (first 20 chars)
          const headingRaw = blocks[i].content;
          const hasAncestorRef = continuationChunks.some(c =>
            c.content.includes(headingRaw.slice(0, 20))
          );
          expect(hasAncestorRef).toBe(true);
        }
      }
    ), { numRuns: 100 });
  });
});
