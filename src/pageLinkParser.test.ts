import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parse, serialize, transformToMarkdownLinks, type Segment } from './pageLinkParser';

describe('parse', () => {
  it('returns empty array for empty string', () => {
    expect(parse('')).toEqual([]);
  });

  it('returns single text segment when no links present', () => {
    expect(parse('hello world')).toEqual([{ type: 'text', value: 'hello world' }]);
  });

  it('parses a single page link', () => {
    expect(parse('see [[My Page]] here')).toEqual([
      { type: 'text', value: 'see ' },
      { type: 'pageLink', name: 'My Page' },
      { type: 'text', value: ' here' },
    ]);
  });

  it('parses multiple links', () => {
    expect(parse('link [[A]] and [[B]] end')).toEqual([
      { type: 'text', value: 'link ' },
      { type: 'pageLink', name: 'A' },
      { type: 'text', value: ' and ' },
      { type: 'pageLink', name: 'B' },
      { type: 'text', value: ' end' },
    ]);
  });

  it('parses consecutive links [[a]][[b]]', () => {
    expect(parse('[[a]][[b]]')).toEqual([
      { type: 'pageLink', name: 'a' },
      { type: 'pageLink', name: 'b' },
    ]);
  });

  it('parses link at start of string', () => {
    expect(parse('[[start]] rest')).toEqual([
      { type: 'pageLink', name: 'start' },
      { type: 'text', value: ' rest' },
    ]);
  });

  it('parses link at end of string', () => {
    expect(parse('rest [[end]]')).toEqual([
      { type: 'text', value: 'rest ' },
      { type: 'pageLink', name: 'end' },
    ]);
  });

  it('treats empty brackets [[]] as plain text', () => {
    const result = parse('before [[]] after');
    expect(result).toEqual([{ type: 'text', value: 'before [[]] after' }]);
    // No pageLink segments
    expect(result.every((s) => s.type === 'text')).toBe(true);
  });

  it('extracts innermost match from nested brackets [[[text]]]', () => {
    const result = parse('[[[nested]]]');
    expect(result).toEqual([
      { type: 'text', value: '[' },
      { type: 'pageLink', name: 'nested' },
      { type: 'text', value: ']' },
    ]);
  });

  it('handles page names with spaces', () => {
    expect(parse('[[page with spaces]]')).toEqual([
      { type: 'pageLink', name: 'page with spaces' },
    ]);
  });

  it('handles page names with special characters', () => {
    expect(parse('[[café & résumé]]')).toEqual([
      { type: 'pageLink', name: 'café & résumé' },
    ]);
  });
});

describe('serialize', () => {
  it('returns empty string for empty segment list', () => {
    expect(serialize([])).toBe('');
  });

  it('serializes text segments as their value', () => {
    const segments: Segment[] = [{ type: 'text', value: 'hello world' }];
    expect(serialize(segments)).toBe('hello world');
  });

  it('serializes pageLink segments with double brackets', () => {
    const segments: Segment[] = [{ type: 'pageLink', name: 'My Page' }];
    expect(serialize(segments)).toBe('[[My Page]]');
  });

  it('serializes mixed segments correctly', () => {
    const segments: Segment[] = [
      { type: 'text', value: 'see ' },
      { type: 'pageLink', name: 'A' },
      { type: 'text', value: ' and ' },
      { type: 'pageLink', name: 'B' },
    ];
    expect(serialize(segments)).toBe('see [[A]] and [[B]]');
  });

  it('round-trips with parse for text with links', () => {
    const input = 'check [[Page One]] and [[Page Two]] now';
    expect(serialize(parse(input))).toBe(input);
  });

  it('round-trips with parse for plain text', () => {
    const input = 'no links here';
    expect(serialize(parse(input))).toBe(input);
  });

  it('round-trips with parse for empty brackets', () => {
    const input = 'before [[]] after';
    expect(serialize(parse(input))).toBe(input);
  });
});

describe('transformToMarkdownLinks', () => {
  it('returns empty string for empty input', () => {
    expect(transformToMarkdownLinks('')).toBe('');
  });

  it('returns text unchanged when no links present', () => {
    expect(transformToMarkdownLinks('hello world')).toBe('hello world');
  });

  it('transforms a single page link to markdown', () => {
    expect(transformToMarkdownLinks('see [[My Page]] here')).toBe(
      'see [My Page](logseq://page/My%20Page) here'
    );
  });

  it('transforms multiple links', () => {
    expect(transformToMarkdownLinks('[[A]] and [[B]]')).toBe(
      '[A](logseq://page/A) and [B](logseq://page/B)'
    );
  });

  it('transforms consecutive links', () => {
    expect(transformToMarkdownLinks('[[a]][[b]]')).toBe(
      '[a](logseq://page/a)[b](logseq://page/b)'
    );
  });

  it('leaves empty brackets [[]] as-is', () => {
    expect(transformToMarkdownLinks('before [[]] after')).toBe('before [[]] after');
  });

  it('encodes special characters in the URL', () => {
    expect(transformToMarkdownLinks('[[café & résumé]]')).toBe(
      '[café & résumé](logseq://page/caf%C3%A9%20%26%20r%C3%A9sum%C3%A9)'
    );
  });

  it('handles page names with spaces', () => {
    expect(transformToMarkdownLinks('[[my page]]')).toBe(
      '[my page](logseq://page/my%20page)'
    );
  });
});


/**
 * Validates: Requirements 4.3, 1.5, 4.1, 4.2
 *
 * Property 1: Parse–Serialize Round Trip
 * For any raw text string (including strings with [[page name]] patterns,
 * strings without them, strings with empty brackets [[]], and strings with
 * nested brackets), serialize(parse(input)) SHALL produce a string equal
 * to the original input.
 */
describe('Feature: clickable-page-links, Property 1: Parse-Serialize Round Trip', () => {
  /** Arbitrary for a valid page name: non-empty, no bracket characters. */
  const validPageName = fc
    .string({ minLength: 1, maxLength: 30 })
    .filter((s) => !s.includes('[') && !s.includes(']') && s.length > 0);

  /** Arbitrary for plain text fragments. */
  const plainText = fc.string({ minLength: 0, maxLength: 30 });

  /**
   * Arbitrary that builds a string by interleaving plain text with
   * embedded [[validName]] page link patterns.
   */
  const textWithPageLinks = fc
    .tuple(
      plainText,
      fc.array(fc.tuple(validPageName, plainText), { minLength: 0, maxLength: 5 })
    )
    .map(([prefix, pairs]) => {
      let result = prefix;
      for (const [name, suffix] of pairs) {
        result += `[[${name}]]${suffix}`;
      }
      return result;
    });

  it('serialize(parse(input)) === input for arbitrary strings with embedded page links', () => {
    fc.assert(
      fc.property(textWithPageLinks, (input) => {
        expect(serialize(parse(input))).toBe(input);
      }),
      { numRuns: 100 }
    );
  });

  it('serialize(parse(input)) === input for fully arbitrary strings', () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        expect(serialize(parse(input))).toBe(input);
      }),
      { numRuns: 100 }
    );
  });
});


/**
 * Validates: Requirements 1.1, 1.2
 *
 * Property 2: Detection Completeness
 * For any raw text string containing N distinct [[page name]] patterns
 * (where each page name is non-empty and contains no bracket characters),
 * parse(input) SHALL produce exactly N segments of type pageLink, and the
 * name field of each pageLink segment SHALL match the corresponding page
 * name in order of appearance.
 */
describe('Feature: clickable-page-links, Property 2: Detection Completeness', () => {
  /** Arbitrary for a valid page name: non-empty, no bracket characters. */
  const validPageName = fc
    .string({ minLength: 1, maxLength: 30 })
    .filter((s) => !s.includes('[') && !s.includes(']'));

  /** Arbitrary for surrounding plain text that contains no bracket characters. */
  const surroundingText = fc
    .string({ minLength: 0, maxLength: 30 })
    .filter((s) => !s.includes('[') && !s.includes(']'));

  it('parse detects the correct count and names of embedded page links in order', () => {
    fc.assert(
      fc.property(
        surroundingText,
        fc.array(fc.tuple(validPageName, surroundingText), { minLength: 0, maxLength: 8 }),
        (prefix, pairs) => {
          // Build input string: prefix + [[name1]]suffix1 + [[name2]]suffix2 + ...
          const expectedNames: string[] = [];
          let input = prefix;
          for (const [name, suffix] of pairs) {
            input += `[[${name}]]${suffix}`;
            expectedNames.push(name);
          }

          const segments = parse(input);
          const pageLinkSegments = segments.filter(
            (s): s is Extract<Segment, { type: 'pageLink' }> => s.type === 'pageLink'
          );

          // Correct count
          expect(pageLinkSegments.length).toBe(expectedNames.length);

          // Correct names in order
          const actualNames = pageLinkSegments.map((s) => s.name);
          expect(actualNames).toEqual(expectedNames);
        }
      ),
      { numRuns: 100 }
    );
  });
});


/**
 * Validates: Requirements 1.4
 *
 * Property 3: No False Positives on Plain Text
 * For any raw text string that does not contain the substring `[[`,
 * parse(input) SHALL produce only segments of type `text` (zero `pageLink`
 * segments), and the concatenation of all text segment values SHALL equal
 * the original input.
 */
describe('Feature: clickable-page-links, Property 3: No False Positives on Plain Text', () => {
  /** Arbitrary for strings that never contain `[[`. */
  const plainTextWithoutDoubleBracket = fc
    .string()
    .filter((s) => !s.includes('[['));

  it('parse produces zero pageLink segments and concatenated text equals input', () => {
    fc.assert(
      fc.property(plainTextWithoutDoubleBracket, (input) => {
        const segments = parse(input);

        // No pageLink segments
        const pageLinkSegments = segments.filter((s) => s.type === 'pageLink');
        expect(pageLinkSegments.length).toBe(0);

        // Concatenated text equals original input
        const concatenated = segments
          .map((s) => (s.type === 'text' ? s.value : ''))
          .join('');
        expect(concatenated).toBe(input);
      }),
      { numRuns: 100 }
    );
  });
});
