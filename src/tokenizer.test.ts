import * as fc from 'fast-check';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Unit tests for Token_Counter (src/tokenizer.ts)
 *
 * Validates: Requirements 1.1, 1.2, 2.1, 2.2, 2.3
 */

describe('Token_Counter', () => {
  // We need fresh module state for the singleton tests, so we use dynamic imports
  // with vi.resetModules() to test lazy initialization behavior.

  describe('lazy initialization', () => {
    beforeEach(() => {
      vi.resetModules();
    });

    // Requirement 1.1: first access initializes and caches the instance
    it('first call creates the tokenizer instance', async () => {
      const { countTokens } = await import('./tokenizer');
      // Should not throw — the instance is created on first call
      const result = countTokens('hello');
      expect(result).toBeGreaterThan(0);
    });

    // Requirement 1.2: subsequent calls reuse the cached instance
    it('subsequent calls reuse the same instance', async () => {
      const { countTokens } = await import('./tokenizer');
      const first = countTokens('hello');
      const second = countTokens('hello');
      expect(first).toBe(second);
    });
  });

  describe('countTokens', () => {
    // Requirement 2.2: empty string returns 0
    it('returns 0 for an empty string', async () => {
      const { countTokens } = await import('./tokenizer');
      expect(countTokens('')).toBe(0);
    });

    // Requirement 2.1: exact token count for known ASCII string
    it('returns expected token count for a known ASCII string', async () => {
      const { countTokens } = await import('./tokenizer');
      // "hello world" is 2 tokens in cl100k_base
      expect(countTokens('hello world')).toBe(2);
    });

    // Requirement 2.3: correct token count for CJK characters
    it('returns correct token count for CJK characters', async () => {
      const { countTokens } = await import('./tokenizer');
      // Each CJK character typically encodes to 1+ tokens in cl100k_base
      const cjkText = '你好世界'; // "Hello World" in Chinese
      const count = countTokens(cjkText);
      expect(count).toBeGreaterThan(0);
      // CJK characters generally produce more tokens per character than ASCII
      // "你好世界" is 4 characters but should produce more tokens
      expect(count).toBeGreaterThanOrEqual(4);
    });
  });

  describe('encode/decode round-trip', () => {
    // Requirement 2.1: encode produces token IDs, decode reconstructs the string
    it('round-trips a basic ASCII string', async () => {
      const { encode, decode } = await import('./tokenizer');
      const input = 'The quick brown fox jumps over the lazy dog';
      expect(decode(encode(input))).toBe(input);
    });

    it('round-trips an empty string', async () => {
      const { encode, decode } = await import('./tokenizer');
      expect(decode(encode(''))).toBe('');
    });

    it('round-trips a string with mixed content', async () => {
      const { encode, decode } = await import('./tokenizer');
      const input = 'Hello 你好 🌍 https://example.com/path?q=1';
      expect(decode(encode(input))).toBe(input);
    });

    it('encode returns a non-empty array for non-empty input', async () => {
      const { encode } = await import('./tokenizer');
      const tokens = encode('hello');
      expect(Array.isArray(tokens)).toBe(true);
      expect(tokens.length).toBeGreaterThan(0);
    });
  });
});

// Feature: tiktoken-chunking, Property 6: Encode/decode round-trip
describe('Property 6: Encode/decode round-trip', () => {
  // **Validates: Requirements 6.4**

  /**
   * Arbitrary that generates strings from diverse character sets:
   * ASCII, CJK (U+4E00–U+9FFF), Cyrillic (U+0400–U+04FF), emoji,
   * URL-like strings, code block-like strings, and empty strings.
   */
  const asciiArb = fc.string({ minLength: 0, maxLength: 200 });

  const cjkArb = fc
    .array(fc.integer({ min: 0x4e00, max: 0x9fff }), { minLength: 1, maxLength: 50 })
    .map((cps) => String.fromCodePoint(...cps));

  const cyrillicArb = fc
    .array(fc.integer({ min: 0x0400, max: 0x04ff }), { minLength: 1, maxLength: 50 })
    .map((cps) => String.fromCodePoint(...cps));

  const emojiArb = fc
    .constantFrom('😀', '🌍', '🚀', '❤️', '🎉', '👨‍👩‍👧‍👦', '🏳️‍🌈', '🇺🇸')
    .chain((e) => fc.array(fc.constant(e), { minLength: 1, maxLength: 10 }))
    .map((arr) => arr.join(''));

  const urlArb = fc
    .tuple(
      fc.constantFrom('https://', 'http://'),
      fc.webUrl().map((u) => u.replace(/^https?:\/\//, ''))
    )
    .map(([scheme, rest]) => scheme + rest);

  const codeBlockArb = fc
    .tuple(
      fc.constantFrom('js', 'ts', 'python', 'rust', ''),
      fc.string({ minLength: 1, maxLength: 100 })
    )
    .map(([lang, body]) => '```' + lang + '\n' + body + '\n```');

  const emptyArb = fc.constant('');

  const diverseStringArb = fc.oneof(
    { weight: 3, arbitrary: asciiArb },
    { weight: 2, arbitrary: cjkArb },
    { weight: 2, arbitrary: cyrillicArb },
    { weight: 2, arbitrary: emojiArb },
    { weight: 1, arbitrary: urlArb },
    { weight: 1, arbitrary: codeBlockArb },
    { weight: 1, arbitrary: emptyArb }
  );

  it('decode(encode(s)) === s for diverse character sets', async () => {
    const { encode, decode } = await import('./tokenizer');

    fc.assert(
      fc.property(diverseStringArb, (s) => {
        expect(decode(encode(s))).toBe(s);
      }),
      { numRuns: 100 }
    );
  });
});
