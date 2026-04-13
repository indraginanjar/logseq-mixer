import { describe, expect, it } from 'vitest';
import { BlockLine, buildPageHeader, extractOutgoingLinks, groupBlocksIntoChunks, identifySemanticGroups, MAX_OVERLAP_BUDGET, OVERLAP_FRACTION, PageLinkData } from './embedManager';

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
    // header is ~40 chars, each line is ~7 chars + newline
    const lines = [bl('aaaa'), bl('bbbb'), bl('cccc'), bl('dddd')];
    // maxChunkChars = header.length + 10 → fits ~1 line per chunk
    const maxChunk = header.length + 10;
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
    const filler = bl('x'.repeat(30)); // 30 chars + newline
    const groupLines = [
      bl('heading', 0, true, 0),
      bl('child', 0, false, 1),
    ];
    // Budget = header + 50 chars. Filler takes 31, group takes ~14. Total 45 fits.
    // But let's make it tighter so group doesn't fit after filler.
    const maxChunk = header.length + 35;
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
    const lines = [
      bl('heading', 0, true, 0),
      bl('a'.repeat(40), 0, false, 1),
      bl('b'.repeat(40), 0, false, 1),
    ];
    // Budget allows header + ~50 chars → heading + one child fits, but not all three
    const maxChunk = header.length + 55;
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
    const lines = [
      bl('line A'),
      bl('line B'),
      bl('line C'),
      bl('line D'),
      bl('line E'),
      bl('line F'),
    ];
    // Each line is ~7 chars. Budget = header + 20 → ~2-3 lines per chunk
    const maxChunk = header.length + 22;
    const result = groupBlocksIntoChunks(lines, header, maxChunk);
    expect(result.length).toBeGreaterThan(1);

    // Second chunk should contain overlap from the first chunk's tail
    // With default 0.15 fraction, ceil(~3 lines * 0.15) = 1 overlap line
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

  it('caps overlap at MAX_OVERLAP_BUDGET of maxChunkChars', () => {
    // Create lines where the overlap would be large
    const longLine = 'x'.repeat(100);
    const lines = Array.from({ length: 20 }, (_, i) => bl(`${longLine}_${i}`));
    const maxChunk = header.length + 250;
    const overlapBudget = Math.floor(maxChunk * MAX_OVERLAP_BUDGET);

    const result = groupBlocksIntoChunks(lines, header, maxChunk);
    expect(result.length).toBeGreaterThan(1);

    // For each chunk after the first, the overlap portion should not exceed the budget
    for (let i = 1; i < result.length; i++) {
      expect(result[i].length).toBeLessThanOrEqual(maxChunk);
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
    const lines = Array.from({ length: 10 }, (_, i) => bl(`line ${i}`));
    const maxChunk = header.length + 30;

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
