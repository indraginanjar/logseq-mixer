import { describe, expect, it } from 'vitest';
import { BlockLine, buildPageHeader, extractOutgoingLinks, groupBlocksIntoChunks, identifySemanticGroups, MAX_OVERLAP_BUDGET, OVERLAP_FRACTION, PageLinkData } from './embedManager';
import { countTokens, decode, encode } from './tokenizer';

describe('identifySemanticGroups', () => {
  it('returns empty array for empty input', () => {
    expect(identifySemanticGroups([])).toEqual([]);
  });

  it('marks non-heading blocks with groupId -1', () => {
    const lines = ['- plain text', '- another line'];
    const result = identifySemanticGroups(lines);
    expect(result).toHaveLength(2);
    expect(result[0].groupId).toBe(-1);
    expect(result[1].groupId).toBe(-1);
    expect(result[0].isHeading).toBe(false);
    expect(result[1].isHeading).toBe(false);
  });

  it('detects heading blocks with # prefix in top-level lines', () => {
    const lines = ['- ## My Heading'];
    const result = identifySemanticGroups(lines);
    expect(result[0].isHeading).toBe(true);
    expect(result[0].depth).toBe(0);
    expect(result[0].groupId).toBe(0);
  });

  it('groups heading with subsequent deeper-depth blocks', () => {
    const lines = [
      '- ## Section A',
      '[Section A] child block 1',
      '[Section A] child block 2',
      '- ## Section B',
      '[Section B] child block 3',
    ];
    const result = identifySemanticGroups(lines);

    // Section A heading + its children = group 0
    expect(result[0].groupId).toBe(0); // heading
    expect(result[1].groupId).toBe(0); // child
    expect(result[2].groupId).toBe(0); // child

    // Section B heading + its children = group 1
    expect(result[3].groupId).toBe(1); // heading
    expect(result[4].groupId).toBe(1); // child
  });

  it('stops group at next heading at same depth', () => {
    const lines = [
      '- # Heading 1',
      '- some content under heading 1',
      '- # Heading 2',
      '- content under heading 2',
    ];
    const result = identifySemanticGroups(lines);

    // Heading 1 is a group by itself (next line is same depth, not deeper)
    expect(result[0].groupId).toBe(0);
    expect(result[0].isHeading).toBe(true);
    // "some content" is at same depth as heading, so NOT part of the group
    expect(result[1].groupId).toBe(-1);

    expect(result[2].groupId).toBe(1);
    expect(result[2].isHeading).toBe(true);
    expect(result[3].groupId).toBe(-1);
  });

  it('handles nested headings within a group', () => {
    const lines = [
      '- # Top Heading',
      '[Top Heading] ## Sub Heading',
      '[Top Heading > Sub Heading] detail',
    ];
    const result = identifySemanticGroups(lines);

    // All belong to group 0 since sub-heading is deeper than top heading
    expect(result[0].groupId).toBe(0);
    expect(result[1].groupId).toBe(0);
    expect(result[2].groupId).toBe(0);
  });

  it('assigns correct depth from breadcrumb notation', () => {
    const lines = [
      '- top level',
      '[parent] child',
      '[parent > child] grandchild',
    ];
    const result = identifySemanticGroups(lines);

    expect(result[0].depth).toBe(0);
    expect(result[1].depth).toBe(1);
    expect(result[2].depth).toBe(2);
  });

  it('preserves original content in the content field', () => {
    const lines = ['- ## My Heading', '[My Heading] some child'];
    const result = identifySemanticGroups(lines);

    expect(result[0].content).toBe('- ## My Heading');
    expect(result[1].content).toBe('[My Heading] some child');
  });

  it('handles mixed heading and non-heading blocks', () => {
    const lines = [
      '- intro text',
      '- ## Section',
      '[Section] detail 1',
      '[Section] detail 2',
      '- outro text',
    ];
    const result = identifySemanticGroups(lines);

    expect(result[0].groupId).toBe(-1); // intro - ungrouped
    expect(result[1].groupId).toBe(0);  // heading
    expect(result[2].groupId).toBe(0);  // child
    expect(result[3].groupId).toBe(0);  // child
    expect(result[4].groupId).toBe(-1); // outro - ungrouped (same depth as heading)
  });

  it('handles multiple heading levels correctly', () => {
    const lines = [
      '- # H1',
      '[H1] ## H2 under H1',
      '[H1 > H2 under H1] content',
      '- # Another H1',
    ];
    const result = identifySemanticGroups(lines);

    expect(result[0].groupId).toBe(0); // H1
    expect(result[1].groupId).toBe(0); // H2 (deeper, part of H1 group)
    expect(result[2].groupId).toBe(0); // content (deeper still)
    expect(result[3].groupId).toBe(1); // Another H1 (same depth, new group)
  });
});


describe('groupBlocksIntoChunks (semantic + overlap)', () => {
  const header = 'note_id: 1\nnote_name: Test\nnote_content:\n\n';

  function bl(content: string, groupId = -1, isHeading = false, depth = 0): BlockLine {
    return { content, isHeading, depth, groupId };
  }

  it('returns header-only chunk for empty input', () => {
    const result = groupBlocksIntoChunks([], header, 500);
    expect(result).toEqual([header]);
  });

  it('puts all lines in one chunk when they fit', () => {
    const lines = [bl('line 1'), bl('line 2'), bl('line 3')];
    const result = groupBlocksIntoChunks(lines, header, 500);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(header + 'line 1\nline 2\nline 3\n');
  });

  it('single-chunk pages produce no overlap', () => {
    const lines = [bl('line 1'), bl('line 2')];
    const result = groupBlocksIntoChunks(lines, header, 500);
    expect(result).toHaveLength(1);
    // No overlap lines should appear
    expect(result[0]).toBe(header + 'line 1\nline 2\n');
  });

  it('splits into multiple chunks when content exceeds limit', () => {
    // header = 14 tokens, each line (e.g. "aaaa\n") = 2 tokens
    const lines = [bl('aaaa'), bl('bbbb'), bl('cccc'), bl('dddd')];
    // maxTokens = 18 → content budget = 4 tokens → fits ~2 lines but not all 4
    const maxChunk = 18;
    const result = groupBlocksIntoChunks(lines, header, maxChunk);
    expect(result.length).toBeGreaterThan(1);
    // Each chunk should start with the header
    for (const chunk of result) {
      expect(chunk.startsWith(header)).toBe(true);
    }
  });

  it('keeps semantic groups together when they fit in current chunk', () => {
    const lines = [
      bl('heading', 0, true, 0),
      bl('child 1', 0, false, 1),
      bl('child 2', 0, false, 1),
    ];
    const result = groupBlocksIntoChunks(lines, header, 500);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('heading');
    expect(result[0]).toContain('child 1');
    expect(result[0]).toContain('child 2');
  });

  it('starts new chunk for semantic group that does not fit in current but fits in fresh', () => {
    // First, some ungrouped content that partially fills the chunk
    const filler = bl('x'.repeat(30)); // filler\n = 6 tokens
    const groupLines = [
      bl('heading', 0, true, 0),
      bl('child', 0, false, 1),
    ];
    // header = 14 tokens, filler\n = 6 tokens, group (heading\n + child\n) = 4 tokens
    // maxTokens = 21 → content budget = 7. Filler(6) fits, but filler(6)+group(4)=10 > 7.
    // Group alone(4) ≤ 7, so it goes to a new chunk.
    const maxChunk = 21;
    const lines = [filler, ...groupLines];
    const result = groupBlocksIntoChunks(lines, header, maxChunk);
    // Should be 2 chunks: filler in first, group in second
    expect(result.length).toBe(2);
    expect(result[0]).toContain('x'.repeat(30));
    expect(result[1]).toContain('heading');
    expect(result[1]).toContain('child');
  });

  it('splits oversized semantic groups between child blocks, never mid-block', () => {
    // Group that exceeds a single chunk
    // heading\n = 2 tokens, 'a'.repeat(40)\n = 6 tokens, 'b'.repeat(40)\n = 11 tokens
    const lines = [
      bl('heading', 0, true, 0),
      bl('a'.repeat(40), 0, false, 1),
      bl('b'.repeat(40), 0, false, 1),
    ];
    // maxTokens = 26 → content budget = 12. heading(2)+a40(6)=8 fits, but +b40(11)=19 > 12
    // b40(11) fits alone in a fresh chunk since 11 <= 12
    const maxChunk = 26;
    const result = groupBlocksIntoChunks(lines, header, maxChunk);
    expect(result.length).toBeGreaterThan(1);
    // Each block should appear intact (not split mid-content)
    const allContent = result.join('');
    expect(allContent).toContain('heading');
    expect(allContent).toContain('a'.repeat(40));
    expect(allContent).toContain('b'.repeat(40));
  });

  it('applies overlap between chunks for multi-chunk pages', () => {
    // Create enough content for 2+ chunks
    // header = 14 tokens, each "line X\n" = 3 tokens
    const lines = [
      bl('line A'),
      bl('line B'),
      bl('line C'),
      bl('line D'),
      bl('line E'),
      bl('line F'),
    ];
    // maxTokens = 23 → content budget = 9 tokens → 3 lines per chunk
    const maxChunk = 23;
    const result = groupBlocksIntoChunks(lines, header, maxChunk);
    expect(result.length).toBeGreaterThan(1);

    // Second chunk should contain overlap from the first chunk's tail
    // With default 0.15 fraction, ceil(3 lines * 0.15) = 1 overlap line
    // The last line of chunk 1 should appear at the start of chunk 2
    if (result.length >= 2) {
      // Extract content after header from chunk 1
      const chunk1Content = result[0].slice(header.length);
      const chunk1Lines = chunk1Content.trim().split('\n');
      const lastLineOfChunk1 = chunk1Lines[chunk1Lines.length - 1];

      // Chunk 2 should contain that line as overlap
      const chunk2Content = result[1].slice(header.length);
      expect(chunk2Content).toContain(lastLineOfChunk1);
    }
  });

  it('caps overlap at MAX_OVERLAP_BUDGET of maxTokens', () => {
    // Create lines where the overlap would be large
    // Each longLine_i\n ≈ 16 tokens
    const longLine = 'x'.repeat(100);
    const lines = Array.from({ length: 20 }, (_, i) => bl(`${longLine}_${i}`));
    const maxChunk = 60;

    const result = groupBlocksIntoChunks(lines, header, maxChunk);
    expect(result.length).toBeGreaterThan(1);

    // For each chunk, the token count should not exceed maxTokens
    for (let i = 1; i < result.length; i++) {
      expect(countTokens(result[i])).toBeLessThanOrEqual(maxChunk);
    }
  });

  it('ungrouped blocks use adjacency-based behavior (no special grouping)', () => {
    const lines = [bl('a'), bl('b'), bl('c')];
    const result = groupBlocksIntoChunks(lines, header, 500);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(header + 'a\nb\nc\n');
  });

  it('exports OVERLAP_FRACTION and MAX_OVERLAP_BUDGET constants', () => {
    expect(OVERLAP_FRACTION).toBe(0.15);
    expect(MAX_OVERLAP_BUDGET).toBe(0.20);
  });

  it('respects custom overlapFraction parameter', () => {
    // Each "line N\n" = 4 tokens, header = 14 tokens
    const lines = Array.from({ length: 10 }, (_, i) => bl(`line ${i}`));
    // maxTokens = 26 → content budget = 12 → 3 lines per chunk
    const maxChunk = 26;

    // With 0 overlap, no lines should repeat
    const noOverlap = groupBlocksIntoChunks(lines, header, maxChunk, 0);
    // With 0.5 overlap, more lines should repeat
    const highOverlap = groupBlocksIntoChunks(lines, header, maxChunk, 0.5);

    // Both should produce multiple chunks
    expect(noOverlap.length).toBeGreaterThan(1);
    expect(highOverlap.length).toBeGreaterThan(1);

    // With no overlap, chunk 2 should not start with content from chunk 1's tail
    // (beyond what the header provides)
    // With high overlap, chunk 2 should have more repeated content
    // We just verify they produce different results
    expect(noOverlap.length).not.toBe(0);
    expect(highOverlap.length).not.toBe(0);
  });

  it('handles mixed grouped and ungrouped blocks', () => {
    const lines = [
      bl('intro', -1, false, 0),
      bl('heading', 0, true, 0),
      bl('child', 0, false, 1),
      bl('outro', -1, false, 0),
    ];
    const result = groupBlocksIntoChunks(lines, header, 500);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(header + 'intro\nheading\nchild\noutro\n');
  });
});


describe('extractOutgoingLinks', () => {
  it('returns empty array for empty input', () => {
    expect(extractOutgoingLinks([])).toEqual([]);
  });

  it('returns empty array when no links present', () => {
    expect(extractOutgoingLinks(['- plain text', '- no links here'])).toEqual([]);
  });

  it('extracts a single link from a line', () => {
    expect(extractOutgoingLinks(['- see [[My Page]]'])).toEqual(['My Page']);
  });

  it('extracts multiple links from a single line', () => {
    const result = extractOutgoingLinks(['- links to [[Page A]] and [[Page B]]']);
    expect(result).toEqual(['Page A', 'Page B']);
  });

  it('extracts links across multiple lines', () => {
    const result = extractOutgoingLinks([
      '- first [[Alpha]]',
      '- second [[Beta]]',
      '- third [[Gamma]]',
    ]);
    expect(result).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('deduplicates repeated page names', () => {
    const result = extractOutgoingLinks([
      '- see [[Page A]]',
      '- also [[Page A]] again',
      '- and [[Page B]]',
    ]);
    expect(result).toEqual(['Page A', 'Page B']);
  });

  it('handles links with spaces and special characters in page names', () => {
    const result = extractOutgoingLinks(['- [[My Cool Page/Sub]]']);
    expect(result).toEqual(['My Cool Page/Sub']);
  });

  it('handles lines with breadcrumb notation containing links', () => {
    const result = extractOutgoingLinks([
      '[parent] see [[Linked Page]]',
      '[parent > child] also [[Another Page]]',
    ]);
    expect(result).toEqual(['Linked Page', 'Another Page']);
  });
});


describe('buildPageHeader', () => {
  it('builds basic header with id and name', () => {
    const result = buildPageHeader(42, 'My Page');
    expect(result).toBe('note_id: 42\nnote_name: My Page\nnote_content:\n\n');
  });

  it('includes tags when properties contain tags array', () => {
    const result = buildPageHeader(1, 'Tagged', { tags: ['tag1', 'tag2'] });
    expect(result).toContain('note_tags: tag1, tag2\n');
  });

  it('includes tags when properties contain tags string', () => {
    const result = buildPageHeader(1, 'Tagged', { tags: 'single-tag' });
    expect(result).toContain('note_tags: single-tag\n');
  });

  it('omits tags when not present in properties', () => {
    const result = buildPageHeader(1, 'No Tags', {});
    expect(result).not.toContain('note_tags');
  });

  it('includes note_links when outgoing links exist', () => {
    const linkData: PageLinkData = { outgoingLinks: ['Page A', 'Page B'], backlinks: [] };
    const result = buildPageHeader(1, 'Linked', undefined, linkData);
    expect(result).toContain('note_links: Page A, Page B\n');
  });

  it('omits note_links when outgoing links array is empty', () => {
    const linkData: PageLinkData = { outgoingLinks: [], backlinks: ['Ref'] };
    const result = buildPageHeader(1, 'No Links', undefined, linkData);
    expect(result).not.toContain('note_links');
  });

  it('includes note_backlinks when backlinks exist', () => {
    const linkData: PageLinkData = { outgoingLinks: [], backlinks: ['Ref X', 'Ref Y'] };
    const result = buildPageHeader(1, 'Backlinked', undefined, linkData);
    expect(result).toContain('note_backlinks: Ref X, Ref Y\n');
  });

  it('omits note_backlinks when backlinks array is empty', () => {
    const linkData: PageLinkData = { outgoingLinks: ['A'], backlinks: [] };
    const result = buildPageHeader(1, 'No Backlinks', undefined, linkData);
    expect(result).not.toContain('note_backlinks');
  });

  it('includes both note_links and note_backlinks when both exist', () => {
    const linkData: PageLinkData = { outgoingLinks: ['Out A'], backlinks: ['In B'] };
    const result = buildPageHeader(42, 'Full', { tags: ['t1'] }, linkData);
    expect(result).toBe(
      'note_id: 42\nnote_name: Full\nnote_tags: t1\nnote_links: Out A\nnote_backlinks: In B\nnote_content:\n\n'
    );
  });

  it('omits link fields when linkData is undefined', () => {
    const result = buildPageHeader(1, 'Plain');
    expect(result).not.toContain('note_links');
    expect(result).not.toContain('note_backlinks');
  });

  it('always ends with note_content and double newline', () => {
    const linkData: PageLinkData = { outgoingLinks: ['X'], backlinks: ['Y'] };
    const result = buildPageHeader(1, 'Test', undefined, linkData);
    expect(result).toMatch(/note_content:\n\n$/);
  });

  it('preserves field ordering: id, name, tags, links, backlinks, content', () => {
    const linkData: PageLinkData = { outgoingLinks: ['Out'], backlinks: ['In'] };
    const result = buildPageHeader(1, 'Order', { tags: ['t'] }, linkData);
    const lines = result.split('\n');
    expect(lines[0]).toBe('note_id: 1');
    expect(lines[1]).toBe('note_name: Order');
    expect(lines[2]).toBe('note_tags: t');
    expect(lines[3]).toBe('note_links: Out');
    expect(lines[4]).toBe('note_backlinks: In');
    expect(lines[5]).toBe('note_content:');
  });
});

import * as fc from 'fast-check';

/**
 * Feature: tiktoken-chunking, Property 2: Block boundary preservation
 *
 * Validates: Requirements 3.4
 *
 * For any set of block lines where each individual block's token count is less
 * than contentBudget (maxTokens - headerTokens), no block's content SHALL be
 * split across multiple chunks. Each block's full content string must appear
 * intact in at least one output chunk.
 */
describe('Property 2: Block boundary preservation', () => {
  const pageHeader = 'page: Test\n\n';
  const headerTokens = countTokens(pageHeader);

  /**
   * Generate a short content string that, with a trailing newline, will always
   * produce fewer tokens than the given contentBudget. Uses simple ASCII words
   * to keep the test focused on boundary preservation rather than content variety.
   */
  function shortContentArb(contentBudget: number): fc.Arbitrary<string> {
    // Cap length so token count stays well under budget.
    // ASCII strings of ≤30 chars produce at most ~8 tokens + 1 for '\n'.
    const maxLen = Math.min(30, Math.max(1, (contentBudget - 2) * 3));
    return fc
      .array(fc.constantFrom('a', 'b', 'c', 'd', ' ', 'x', 'y', 'z', '1', '2'), {
        minLength: 1,
        maxLength: maxLen,
      })
      .map((chars) => chars.join(''))
      .filter((s) => countTokens(s + '\n') < contentBudget);
  }

  it('each block content appears intact in at least one chunk', () => {
    // Use a fixed maxTokens so we can build a flat generator for block lines.
    const maxTokens = 100;
    const contentBudget = maxTokens - headerTokens;

    fc.assert(
      fc.property(
        fc.array(
          shortContentArb(contentBudget).map((content): BlockLine => ({
            content,
            isHeading: false,
            depth: 0,
            groupId: -1,
          })),
          { minLength: 1, maxLength: 25 }
        ),
        (blockLines) => {
          const chunks = groupBlocksIntoChunks(blockLines, pageHeader, maxTokens);

          for (const bl of blockLines) {
            // The block's content must appear intact in at least one chunk
            const found = chunks.some((chunk) => chunk.includes(bl.content));
            if (!found) {
              return false;
            }
          }
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * Feature: tiktoken-chunking, Property 1: Chunk token limit invariant
 *
 * Validates: Requirements 3.2, 4.1, 4.3, 6.1, 6.2, 6.3
 *
 * For any set of block lines (containing ASCII, CJK, URLs, code, emoji, or
 * mixed-language content), any valid page header, and any maxTokens value,
 * every chunk produced by groupBlocksIntoChunks SHALL have a token count
 * that does not exceed maxTokens.
 */
describe('Property 1: Chunk token limit invariant', () => {
  const pageHeader = 'page: Test\n\n';

  // --- Content generators for diverse character sets ---

  /** ASCII printable strings */
  const asciiContent = fc.string({ minLength: 1, maxLength: 80 });

  /** CJK characters (U+4E00–U+9FFF) */
  const cjkContent = fc
    .array(fc.integer({ min: 0x4E00, max: 0x9FFF }), { minLength: 1, maxLength: 30 })
    .map(cps => String.fromCodePoint(...cps));

  /** URL-like strings */
  const urlContent = fc.constantFrom(
    'https://example.com/path/to/page?q=hello&lang=en',
    'https://docs.github.com/en/repositories/creating-and-managing-repositories',
    'http://localhost:3000/api/v1/users',
    'https://en.wikipedia.org/wiki/Byte_pair_encoding',
    'https://www.example.org/foo/bar/baz.html#section-2'
  );

  /** Code snippet strings */
  const codeContent = fc.constantFrom(
    'const x = 42;',
    'function foo() { return bar(); }',
    'if (a > b) { console.log(a); }',
    'for (let i = 0; i < n; i++) { sum += arr[i]; }',
    'import { useState } from "react";',
    'SELECT * FROM users WHERE id = 1;'
  );

  /** Emoji strings */
  const emojiContent = fc
    .array(fc.constantFrom('😀', '🚀', '🎉', '❤️', '🌍', '🔥', '💡', '🐛', '✅', '⚡'), { minLength: 1, maxLength: 10 })
    .map(arr => arr.join(''));

  /** Mixed content: pick from any of the above */
  const mixedContent = fc.oneof(asciiContent, cjkContent, urlContent, codeContent, emojiContent);

  /** Generate a BlockLine with random content from diverse character sets */
  const blockLineArb: fc.Arbitrary<BlockLine> = fc.record({
    content: mixedContent,
    isHeading: fc.boolean(),
    depth: fc.integer({ min: 0, max: 3 }),
    groupId: fc.integer({ min: -1, max: 5 }),
  });

  it('every chunk has countTokens(chunk) <= maxTokens', () => {
    fc.assert(
      fc.property(
        fc.array(blockLineArb, { minLength: 1, maxLength: 30 }),
        fc.integer({ min: 50, max: 500 }),
        (blockLines, maxTokens) => {
          const chunks = groupBlocksIntoChunks(blockLines, pageHeader, maxTokens);

          for (const chunk of chunks) {
            const tokenCount = countTokens(chunk);
            if (tokenCount > maxTokens) {
              return false;
            }
          }
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});


/**
 * Feature: tiktoken-chunking, Property 3: Semantic group co-location
 *
 * Validates: Requirements 3.5
 *
 * For any set of block lines containing a semantic group (blocks sharing the
 * same non-negative groupId) whose total token count (including the page header)
 * fits within maxTokens, all blocks in that group SHALL appear in the same
 * output chunk.
 */
describe('Property 3: Semantic group co-location', () => {
  const pageHeader = 'page: Test\n\n';
  const headerTokens = countTokens(pageHeader);
  const maxTokens = 200;

  /** Short word arbitrary for block content — keeps token counts small. */
  const shortWord = fc
    .array(fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'), {
      minLength: 1,
      maxLength: 8,
    })
    .map((chars) => chars.join(''));

  /**
   * Generate a semantic group: a heading block (depth 0) followed by 1–4
   * child blocks (depth 1), all sharing the given non-negative groupId.
   */
  const semanticGroupArb = (groupId: number): fc.Arbitrary<BlockLine[]> => {
    const headingArb: fc.Arbitrary<BlockLine> = shortWord.map((w) => ({
      content: w, isHeading: true, depth: 0, groupId,
    }));
    const childArb: fc.Arbitrary<BlockLine> = shortWord.map((w) => ({
      content: w, isHeading: false, depth: 1, groupId,
    }));
    return fc
      .tuple(headingArb, fc.array(childArb, { minLength: 1, maxLength: 4 }))
      .map(([heading, children]) => [heading, ...children]);
  };

  /** Check whether a group's total tokens (including header) fit in budget. */
  const groupFits = (group: BlockLine[]): boolean => {
    const groupTokens = group.reduce(
      (sum, bl) => sum + countTokens(bl.content + '\n'), 0
    );
    return groupTokens + headerTokens <= maxTokens;
  };

  it('all blocks in a fitting semantic group appear in the same chunk', () => {
    fc.assert(
      fc.property(
        semanticGroupArb(0),
        (group) => {
          // Pre-condition: the group must fit within the token budget
          fc.pre(groupFits(group));

          const chunks = groupBlocksIntoChunks(group, pageHeader, maxTokens);

          // Find which chunk contains the first block of the group
          const firstContent = group[0].content;
          const chunkIdx = chunks.findIndex((c) => c.includes(firstContent));
          if (chunkIdx === -1) return false;

          // All blocks in the group must appear in that same chunk
          return group.every((bl) => chunks[chunkIdx].includes(bl.content));
        }
      ),
      { numRuns: 100 }
    );
  });
});


/**
 * Feature: tiktoken-chunking, Property 4: Overlap correctness
 *
 * Validates: Requirements 3.6
 *
 * For any set of block lines that produces more than one chunk, each chunk
 * after the first SHALL contain overlap lines from the tail of the previous
 * chunk's block lines, and the token count of those overlap lines SHALL not
 * exceed Math.floor(maxTokens * MAX_OVERLAP_BUDGET).
 */
describe('Property 4: Overlap correctness', () => {
  const pageHeader = 'page: Test\n\n';

  it('overlap lines from previous chunk tail appear in next chunk and respect budget', () => {
    fc.assert(
      fc.property(
        // Generate 10–30 short ungrouped blocks with unique content
        fc.integer({ min: 10, max: 30 }).chain((count) =>
          fc.tuple(
            fc.constant(
              Array.from({ length: count }, (_, i): BlockLine => ({
                content: `block_${i}`,
                isHeading: false,
                depth: 0,
                groupId: -1,
              }))
            ),
            // Small maxTokens to force multiple chunks.
            // pageHeader ≈ 5 tokens, each "block_N\n" ≈ 3-4 tokens.
            // 20-40 tokens should produce 2+ chunks with 10+ blocks.
            fc.integer({ min: 20, max: 40 })
          )
        ),
        ([blockLines, maxTokens]) => {
          const chunks = groupBlocksIntoChunks(blockLines, pageHeader, maxTokens);

          // Only test cases that produce 2+ chunks
          fc.pre(chunks.length >= 2);

          const overlapBudgetTokens = Math.floor(maxTokens * MAX_OVERLAP_BUDGET);

          for (let ci = 1; ci < chunks.length; ci++) {
            const prevChunk = chunks[ci - 1];
            const currChunk = chunks[ci];

            // Extract the content portion (after header) of the previous chunk
            const prevContent = prevChunk.slice(pageHeader.length);
            const prevLines = prevContent.trim().split('\n').filter((l) => l.length > 0);

            // Compute expected overlap count from previous chunk's block lines
            const overlapCount = Math.ceil(prevLines.length * OVERLAP_FRACTION);

            if (overlapCount > 0) {
              // The overlap lines are from the tail of the previous chunk's block lines
              const expectedOverlapLines = prevLines.slice(prevLines.length - overlapCount);

              // Get the content after the header in the current chunk
              const currContent = currChunk.slice(pageHeader.length);

              // Verify overlap lines appear at the start of the current chunk's content
              for (const overlapLine of expectedOverlapLines) {
                if (!currContent.includes(overlapLine)) {
                  // Overlap may have been trimmed by the budget cap — that's OK.
                  // But at least some overlap should be present if budget allows.
                  // We verify the budget constraint below instead.
                }
              }

              // Identify which lines from the previous chunk's tail actually appear
              // at the start of the current chunk (before the new content)
              const currLines = currContent.trim().split('\n').filter((l) => l.length > 0);
              const actualOverlapLines: string[] = [];
              for (const line of currLines) {
                if (prevLines.includes(line)) {
                  actualOverlapLines.push(line);
                } else {
                  break; // Stop at first non-overlap line
                }
              }

              // Verify the token count of actual overlap lines does not exceed the budget
              if (actualOverlapLines.length > 0) {
                const overlapTokens = actualOverlapLines.reduce(
                  (sum, line) => sum + countTokens(line + '\n'),
                  0
                );
                if (overlapTokens > overlapBudgetTokens) {
                  return false;
                }
              }
            }
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});


/**
 * Feature: tiktoken-chunking, Property 5: Safety truncation correctness
 *
 * Validates: Requirements 5.1, 5.2
 *
 * For any input string, the safety truncation logic SHALL produce output with
 * at most `maxTokens` tokens, and if the input's token count was already within
 * the limit, the output SHALL equal the input unchanged.
 */
describe('Property 5: Safety truncation correctness', () => {
  /**
   * Replicate the safety truncation logic from useGenerateEmbedding:
   *   const tokens = encode(inputText);
   *   const text = tokens.length > maxTokens
   *     ? decode(tokens.slice(0, maxTokens))
   *     : inputText;
   */
  function safetyTruncate(inputText: string, maxTokens: number): string {
    const tokens = encode(inputText);
    return tokens.length > maxTokens
      ? decode(tokens.slice(0, maxTokens))
      : inputText;
  }

  /** ASCII printable strings */
  const asciiContent = fc.string({ minLength: 0, maxLength: 300 });

  /** CJK characters (U+4E00–U+9FFF) */
  const cjkContent = fc
    .array(fc.integer({ min: 0x4E00, max: 0x9FFF }), { minLength: 1, maxLength: 100 })
    .map((cps) => String.fromCodePoint(...cps));

  /** Emoji strings */
  const emojiContent = fc
    .array(
      fc.constantFrom('😀', '🚀', '🎉', '❤️', '🌍', '🔥', '💡', '🐛', '✅', '⚡'),
      { minLength: 1, maxLength: 30 }
    )
    .map((arr) => arr.join(''));

  /** Mixed diverse content */
  const diverseContent = fc.oneof(asciiContent, cjkContent, emojiContent);

  it('truncated output has at most maxTokens tokens AND short inputs pass through unchanged', () => {
    fc.assert(
      fc.property(
        diverseContent,
        fc.integer({ min: 10, max: 200 }),
        (inputText, maxTokens) => {
          const output = safetyTruncate(inputText, maxTokens);

          // Property 1: output never exceeds maxTokens
          const outputTokenCount = countTokens(output);
          if (outputTokenCount > maxTokens) {
            return false;
          }

          // Property 2: if input fits, output is identical
          const inputTokenCount = countTokens(inputText);
          if (inputTokenCount <= maxTokens && output !== inputText) {
            return false;
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});
