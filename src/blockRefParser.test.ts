import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parse, serialize, transformToMarkdownLinks, transformBlockAnnotations } from './blockRefParser';
import { transformToMarkdownLinks as transformPageLinks } from './pageLinkParser';

describe('parse', () => {
  it('returns empty array for empty string', () => {
    expect(parse('')).toEqual([]);
  });

  it('returns single text segment when no refs present', () => {
    expect(parse('hello world')).toEqual([{ type: 'text', value: 'hello world' }]);
  });

  it('parses a single block reference', () => {
    expect(parse('see ((a1b2c3d4-e5f6-7890-abcd-ef0123456789)) here')).toEqual([
      { type: 'text', value: 'see ' },
      { type: 'blockRef', uuid: 'a1b2c3d4-e5f6-7890-abcd-ef0123456789' },
      { type: 'text', value: ' here' },
    ]);
  });

  it('parses multiple block references', () => {
    expect(parse('ref ((aa-bb)) and ((cc-dd)) end')).toEqual([
      { type: 'text', value: 'ref ' },
      { type: 'blockRef', uuid: 'aa-bb' },
      { type: 'text', value: ' and ' },
      { type: 'blockRef', uuid: 'cc-dd' },
      { type: 'text', value: ' end' },
    ]);
  });

  it('parses consecutive block references ((uuid1))((uuid2))', () => {
    expect(parse('((aa-bb))((cc-dd))')).toEqual([
      { type: 'blockRef', uuid: 'aa-bb' },
      { type: 'blockRef', uuid: 'cc-dd' },
    ]);
  });

  it('treats non-UUID content ((hello)) as plain text', () => {
    const result = parse('before ((hello)) after');
    expect(result).toEqual([{ type: 'text', value: 'before ((hello)) after' }]);
    expect(result.every((s) => s.type === 'text')).toBe(true);
  });

  it('treats empty parens (()) as plain text', () => {
    const result = parse('before (()) after');
    expect(result).toEqual([{ type: 'text', value: 'before (()) after' }]);
    expect(result.every((s) => s.type === 'text')).toBe(true);
  });

  it('parses ref at start of string', () => {
    expect(parse('((ab-cd)) rest')).toEqual([
      { type: 'blockRef', uuid: 'ab-cd' },
      { type: 'text', value: ' rest' },
    ]);
  });

  it('parses ref at end of string', () => {
    expect(parse('rest ((ab-cd))')).toEqual([
      { type: 'text', value: 'rest ' },
      { type: 'blockRef', uuid: 'ab-cd' },
    ]);
  });
});

describe('serialize', () => {
  it('returns empty string for empty segment list', () => {
    expect(serialize([])).toBe('');
  });

  it('serializes text segments as their value', () => {
    expect(serialize([{ type: 'text', value: 'hello world' }])).toBe('hello world');
  });

  it('serializes blockRef segments with double parens', () => {
    expect(serialize([{ type: 'blockRef', uuid: 'ab-cd' }])).toBe('((ab-cd))');
  });

  it('serializes mixed segments correctly', () => {
    expect(
      serialize([
        { type: 'text', value: 'see ' },
        { type: 'blockRef', uuid: 'aa-bb' },
        { type: 'text', value: ' and ' },
        { type: 'blockRef', uuid: 'cc-dd' },
      ])
    ).toBe('see ((aa-bb)) and ((cc-dd))');
  });

  it('round-trips with parse for text with refs', () => {
    const input = 'check ((a1b2c3d4-e5f6-7890-abcd-ef0123456789)) and ((aa-bb)) now';
    expect(serialize(parse(input))).toBe(input);
  });

  it('round-trips with parse for plain text', () => {
    const input = 'no refs here';
    expect(serialize(parse(input))).toBe(input);
  });

  it('round-trips with parse for non-UUID content in parens', () => {
    const input = 'before ((hello)) after';
    expect(serialize(parse(input))).toBe(input);
  });

  it('round-trips with parse for empty parens', () => {
    const input = 'before (()) after';
    expect(serialize(parse(input))).toBe(input);
  });
});

describe('transformToMarkdownLinks', () => {
  it('returns empty string for empty input', () => {
    expect(transformToMarkdownLinks('')).toBe('');
  });

  it('returns text unchanged when no refs present', () => {
    expect(transformToMarkdownLinks('hello world')).toBe('hello world');
  });

  it('transforms a single block ref to markdown link', () => {
    expect(transformToMarkdownLinks('see ((ab-cd)) here')).toBe(
      'see [block:ab-cd](logseq://block/ab-cd) here'
    );
  });

  it('transforms multiple refs', () => {
    expect(transformToMarkdownLinks('((aa-bb)) and ((cc-dd))')).toBe(
      '[block:aa-bb](logseq://block/aa-bb) and [block:cc-dd](logseq://block/cc-dd)'
    );
  });

  it('transforms consecutive refs', () => {
    expect(transformToMarkdownLinks('((aa-bb))((cc-dd))')).toBe(
      '[block:aa-bb](logseq://block/aa-bb)[block:cc-dd](logseq://block/cc-dd)'
    );
  });

  it('leaves non-UUID content ((hello)) as-is', () => {
    expect(transformToMarkdownLinks('before ((hello)) after')).toBe(
      'before ((hello)) after'
    );
  });

  it('leaves empty parens (()) as-is', () => {
    expect(transformToMarkdownLinks('before (()) after')).toBe('before (()) after');
  });

  it('transforms full UUID format', () => {
    const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef0123456789';
    expect(transformToMarkdownLinks(`see ((${uuid})) here`)).toBe(
      `see [block:${uuid}](logseq://block/${uuid}) here`
    );
  });
});


/**
 * Feature: clickable-block-references, Property 3: Parse-Serialize Round Trip
 *
 * Validates: Requirements 5.7, 9.3, 5.4
 *
 * For any raw text string (including strings with ((uuid)) patterns, strings without
 * them, and strings with non-UUID content inside double parentheses),
 * serialize(parse(input)) SHALL produce a string equal to the original input.
 */
describe('Feature: clickable-block-references, Property 3: Parse-Serialize Round Trip', () => {
  /** Generate a hex string of a given length */
  function hexStringArb(len: number): fc.Arbitrary<string> {
    return fc
      .array(
        fc.constantFrom('0','1','2','3','4','5','6','7','8','9','a','b','c','d','e','f'),
        { minLength: len, maxLength: len }
      )
      .map((chars) => chars.join(''));
  }

  /** Generate a valid UUID-like string (hex chars and hyphens, starts/ends with hex) */
  const validUuid = fc
    .tuple(hexStringArb(8), hexStringArb(4), hexStringArb(4), hexStringArb(4), hexStringArb(12))
    .map(([a, b, c, d, e]) => `${a}-${b}-${c}-${d}-${e}`);

  /** Plain text fragment that does not contain (( to avoid accidental matches */
  const plainText = fc
    .string({ minLength: 0, maxLength: 30 })
    .filter((s) => !s.includes('(('));

  /**
   * Arbitrary that builds a string by interleaving plain text with
   * embedded ((valid-uuid)) block reference patterns.
   */
  const textWithBlockRefs = fc
    .tuple(
      plainText,
      fc.array(fc.tuple(validUuid, plainText), { minLength: 0, maxLength: 5 })
    )
    .map(([prefix, pairs]) => {
      let result = prefix;
      for (const [uuid, suffix] of pairs) {
        result += `((${uuid}))${suffix}`;
      }
      return result;
    });

  it('serialize(parse(input)) === input for arbitrary strings with embedded block refs', () => {
    fc.assert(
      fc.property(textWithBlockRefs, (input) => {
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
 * Feature: clickable-block-references, Property 4: Detection Completeness
 *
 * Validates: Requirements 5.1, 5.2, 9.1
 *
 * For any raw text string containing N embedded ((uuid)) patterns (where each uuid
 * matches the hex-and-hyphens format), parse(input) SHALL produce exactly N segments
 * of type blockRef, and the uuid field of each blockRef segment SHALL match the
 * corresponding UUID in order of appearance.
 */
describe('Feature: clickable-block-references, Property 4: Detection Completeness', () => {
  /** Generate a hex string of a given length */
  function hexStringArb(len: number): fc.Arbitrary<string> {
    return fc
      .array(
        fc.constantFrom('0','1','2','3','4','5','6','7','8','9','a','b','c','d','e','f'),
        { minLength: len, maxLength: len }
      )
      .map((chars) => chars.join(''));
  }

  /** Generate a valid UUID (8-4-4-4-12 hex format) */
  const validUuid = fc
    .tuple(hexStringArb(8), hexStringArb(4), hexStringArb(4), hexStringArb(4), hexStringArb(12))
    .map(([a, b, c, d, e]) => `${a}-${b}-${c}-${d}-${e}`);

  /** Plain text fragment that cannot accidentally form a block ref pattern */
  const surroundingText = fc
    .string({ minLength: 0, maxLength: 30 })
    .filter((s) => !s.includes('(('));

  it('parse detects exactly N blockRef segments with correct UUIDs in order', () => {
    fc.assert(
      fc.property(
        fc.array(validUuid, { minLength: 0, maxLength: 10 }),
        fc.array(surroundingText, { minLength: 11, maxLength: 11 }),
        (uuids, textParts) => {
          // Build input: text0 + ((uuid0)) + text1 + ((uuid1)) + ... + textN
          let input = textParts[0];
          for (let i = 0; i < uuids.length; i++) {
            input += `((${uuids[i]}))` + textParts[i + 1];
          }

          const segments = parse(input);
          const blockRefs = segments.filter((s) => s.type === 'blockRef');

          // Exactly N blockRef segments
          expect(blockRefs.length).toBe(uuids.length);

          // UUIDs match in order (case-insensitive since regex uses gi flag)
          for (let i = 0; i < uuids.length; i++) {
            expect(blockRefs[i].type === 'blockRef' && blockRefs[i].uuid.toLowerCase()).toBe(
              uuids[i].toLowerCase()
            );
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});


/**
 * Feature: clickable-block-references, Property 5: No False Positives on Plain Text
 *
 * Validates: Requirements 5.3
 *
 * For any raw text string that does not contain the substring `((`,
 * parse(input) SHALL produce only segments of type `text` (zero `blockRef` segments),
 * and the concatenation of all text segment values SHALL equal the original input.
 */
describe('Feature: clickable-block-references, Property 5: No False Positives on Plain Text', () => {
  /** Arbitrary strings filtered to not contain `((` */
  const plainTextWithoutDoubleParens = fc
    .string({ minLength: 0, maxLength: 200 })
    .filter((s) => !s.includes('(('));

  it('parse produces zero blockRef segments and concatenated text equals input', () => {
    fc.assert(
      fc.property(plainTextWithoutDoubleParens, (input) => {
        const segments = parse(input);

        // Zero blockRef segments
        const blockRefs = segments.filter((s) => s.type === 'blockRef');
        expect(blockRefs.length).toBe(0);

        // Concatenation of all text segment values equals original input
        const concatenated = segments
          .map((s) => (s.type === 'text' ? s.value : ''))
          .join('');
        expect(concatenated).toBe(input);
      }),
      { numRuns: 100 }
    );
  });
});


/**
 * Feature: clickable-block-references, Property 6: Parser Non-Interference
 *
 * Validates: Requirements 8.2
 *
 * For any raw text string containing both [[page name]] patterns and ((uuid))
 * patterns, applying pageLinkParser.transformToMarkdownLinks first and then
 * blockRefParser.transformToMarkdownLinks SHALL preserve all page link markdown
 * transformations and all block reference markdown transformations. Specifically,
 * the number of logseq://page/ links in the output matches the number of
 * [[page-name]] patterns in the input, and the number of logseq://block/ links
 * in the output matches the number of ((uuid)) patterns in the input.
 */
describe('Feature: clickable-block-references, Property 6: Parser Non-Interference', () => {
  /** Generate a hex string of a given length */
  function hexStringArb(len: number): fc.Arbitrary<string> {
    return fc
      .array(
        fc.constantFrom('0','1','2','3','4','5','6','7','8','9','a','b','c','d','e','f'),
        { minLength: len, maxLength: len }
      )
      .map((chars) => chars.join(''));
  }

  /** Generate a valid UUID (8-4-4-4-12 hex format) */
  const validUuid = fc
    .tuple(hexStringArb(8), hexStringArb(4), hexStringArb(4), hexStringArb(4), hexStringArb(12))
    .map(([a, b, c, d, e]) => `${a}-${b}-${c}-${d}-${e}`);

  /** Generate a valid page name: non-empty, no brackets or parentheses that could interfere */
  const validPageName = fc
    .string({ minLength: 1, maxLength: 20 })
    .filter((s) => !s.includes('[') && !s.includes(']') && !s.includes('(') && !s.includes(')') && s.trim().length > 0);

  /** Plain text that won't accidentally form page link or block ref patterns */
  const safeText = fc
    .string({ minLength: 0, maxLength: 20 })
    .filter((s) => !s.includes('[[') && !s.includes('((') && !s.includes('logseq://'));

  it('page link and block ref counts are preserved after applying both transformers in sequence', () => {
    fc.assert(
      fc.property(
        fc.array(validPageName, { minLength: 1, maxLength: 5 }),
        fc.array(validUuid, { minLength: 1, maxLength: 5 }),
        fc.array(safeText, { minLength: 12, maxLength: 12 }),
        (pageNames, uuids, textParts) => {
          // Build input interleaving page links and block refs with safe text
          // Pattern: text [[page]] text ((uuid)) text [[page]] text ((uuid)) ...
          let input = textParts[0];
          const totalPatterns = Math.min(pageNames.length, uuids.length);
          for (let i = 0; i < totalPatterns; i++) {
            input += `[[${pageNames[i]}]]` + textParts[1 + i * 2];
            input += `((${uuids[i]}))` + textParts[2 + i * 2];
          }

          const expectedPageLinkCount = totalPatterns;
          const expectedBlockRefCount = totalPatterns;

          // Apply transformers in the specified order: page links first, then block refs
          const afterPageLinks = transformPageLinks(input);
          const finalOutput = transformToMarkdownLinks(afterPageLinks);

          // Count logseq://page/ links in output
          const pageLinkMatches = finalOutput.match(/logseq:\/\/page\//g) || [];
          expect(pageLinkMatches.length).toBe(expectedPageLinkCount);

          // Count logseq://block/ links in output
          const blockRefMatches = finalOutput.match(/logseq:\/\/block\//g) || [];
          expect(blockRefMatches.length).toBe(expectedBlockRefCount);
        }
      ),
      { numRuns: 100 }
    );
  });
});


describe('transformBlockAnnotations', () => {
  it('returns empty string for empty input', () => {
    expect(transformBlockAnnotations('')).toBe('');
  });

  it('returns text unchanged when no block annotations present', () => {
    expect(transformBlockAnnotations('hello world')).toBe('hello world');
  });

  // --- [block:uuid] bracketed annotation tests ---

  it('transforms [block:uuid] to markdown link', () => {
    expect(transformBlockAnnotations('see [block:ab-cd] here')).toBe(
      'see [block:ab-cd](logseq://block/ab-cd) here'
    );
  });

  it('transforms [block:uuid] with full UUID format', () => {
    const uuid = '69d2280d-05f5-44c3-81e6-a9874f382e40';
    expect(transformBlockAnnotations(`see [block:${uuid}] here`)).toBe(
      `see [block:${uuid}](logseq://block/${uuid}) here`
    );
  });

  it('transforms multiple [block:uuid] annotations', () => {
    expect(transformBlockAnnotations('[block:aa-bb] and [block:cc-dd]')).toBe(
      '[block:aa-bb](logseq://block/aa-bb) and [block:cc-dd](logseq://block/cc-dd)'
    );
  });

  it('does NOT double-link already-linked [block:uuid](logseq://block/uuid)', () => {
    const input = '[block:ab-cd](logseq://block/ab-cd)';
    expect(transformBlockAnnotations(input)).toBe(input);
  });

  // --- bare block:uuid tests ---

  it('transforms bare block:uuid to markdown link', () => {
    expect(transformBlockAnnotations('see block:ab-cd here')).toBe(
      'see [block:ab-cd](logseq://block/ab-cd) here'
    );
  });

  it('transforms bare block:uuid with full UUID format', () => {
    const uuid = '69d2280d-05f5-44c3-81e6-a9874f382e40';
    expect(transformBlockAnnotations(`reference block:${uuid} in text`)).toBe(
      `reference [block:${uuid}](logseq://block/${uuid}) in text`
    );
  });

  it('transforms bare block:uuid at start of string', () => {
    expect(transformBlockAnnotations('block:ab-cd is relevant')).toBe(
      '[block:ab-cd](logseq://block/ab-cd) is relevant'
    );
  });

  it('transforms bare block:uuid at end of string', () => {
    expect(transformBlockAnnotations('see block:ab-cd')).toBe(
      'see [block:ab-cd](logseq://block/ab-cd)'
    );
  });

  it('does NOT transform block:uuid that is already inside brackets', () => {
    // After first pass converts [block:uuid] → [block:uuid](logseq://...), the bare
    // regex should not match "block:uuid](" since the ] stops it
    const input = '[block:ab-cd](logseq://block/ab-cd)';
    expect(transformBlockAnnotations(input)).toBe(input);
  });

  // --- Mixed patterns ---

  it('handles mix of [block:uuid] and bare block:uuid in same text', () => {
    const input = 'check [block:aa-bb] and also block:cc-dd for details';
    expect(transformBlockAnnotations(input)).toBe(
      'check [block:aa-bb](logseq://block/aa-bb) and also [block:cc-dd](logseq://block/cc-dd) for details'
    );
  });

  it('leaves non-UUID content in brackets unchanged', () => {
    expect(transformBlockAnnotations('see [block:not-a-uuid-xyz] here')).toBe(
      'see [block:not-a-uuid-xyz] here'
    );
  });

  it('leaves regular markdown links unchanged', () => {
    const input = 'click [here](https://example.com)';
    expect(transformBlockAnnotations(input)).toBe(input);
  });

  it('handles text with no hex content after block:', () => {
    // "block:hello" should not match since 'hello' doesn't match hex pattern
    expect(transformBlockAnnotations('see block:hello here')).toBe('see block:hello here');
  });

  it('idempotent: applying twice produces same result', () => {
    const input = 'check [block:aa-bb] and block:cc-dd here';
    const once = transformBlockAnnotations(input);
    const twice = transformBlockAnnotations(once);
    expect(twice).toBe(once);
  });
});
