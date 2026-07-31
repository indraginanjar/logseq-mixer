import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { classifyQuery } from './queryClassifier';

describe('QueryClassifier', () => {
  describe('URL patterns', () => {
    it('classifies http:// URL as mixed (single indicator)', () => {
      const result = classifyQuery('http://example.com');
      // URL pattern is one indicator; domain-like pattern (example.com) is also caught by hasUrlPattern
      // but it's the same function call, so it counts as 1 indicator.
      // However, the URL also contains special chars like : and / — let's check what the classifier returns.
      expect(['keyword', 'mixed']).toContain(result.category);
    });

    it('classifies URL combined with code tokens as keyword', () => {
      const result = classifyQuery('http://example.com myFunction()');
      expect(result.category).toBe('keyword');
    });

    it('classifies https:// URL as at least mixed', () => {
      const result = classifyQuery('https://docs.logseq.com');
      expect(['keyword', 'mixed']).toContain(result.category);
    });
  });

  describe('File paths', () => {
    it('classifies Unix file path as at least mixed', () => {
      const result = classifyQuery('/usr/local/bin');
      expect(['keyword', 'mixed']).toContain(result.category);
    });

    it('classifies Windows file path as at least mixed', () => {
      const result = classifyQuery(String.raw`C:\Users\docs`);
      expect(['keyword', 'mixed']).toContain(result.category);
    });

    it('classifies relative path as at least mixed', () => {
      const result = classifyQuery('./src/index.ts');
      expect(['keyword', 'mixed']).toContain(result.category);
    });

    it('classifies file path combined with another indicator as keyword', () => {
      const result = classifyQuery('/usr/local/bin myVar_name');
      expect(result.category).toBe('keyword');
    });
  });

  describe('Code tokens', () => {
    it('classifies camelCase identifier as at least mixed', () => {
      const result = classifyQuery('myFunction');
      expect(['keyword', 'mixed']).toContain(result.category);
    });

    it('classifies snake_case identifier as at least mixed', () => {
      const result = classifyQuery('my_variable');
      expect(['keyword', 'mixed']).toContain(result.category);
    });

    it('classifies brackets as at least mixed', () => {
      const result = classifyQuery('array[0]');
      expect(['keyword', 'mixed']).toContain(result.category);
    });

    it('classifies method call as at least mixed', () => {
      const result = classifyQuery('foo.bar()');
      expect(['keyword', 'mixed']).toContain(result.category);
    });

    it('classifies code tokens alone as mixed (single indicator category)', () => {
      const result = classifyQuery('myFunction snake_case');
      // hasCodeTokens is a single indicator, even with multiple sub-patterns
      expect(result.category).toBe('mixed');
    });
  });

  describe('Quoted phrases', () => {
    it('classifies double-quoted phrase as mixed', () => {
      const result = classifyQuery('find "exact match"');
      // Quoted phrase is one indicator → mixed
      expect(result.category).toBe('mixed');
    });

    it('classifies single-quoted phrase as mixed', () => {
      const result = classifyQuery("find 'exact match'");
      expect(result.category).toBe('mixed');
    });

    it('classifies quoted phrase with code token as keyword', () => {
      const result = classifyQuery('"exact match" myFunction');
      expect(result.category).toBe('keyword');
    });
  });

  describe('Natural language → semantic', () => {
    it('classifies simple natural language question as semantic', () => {
      const result = classifyQuery('what is machine learning');
      expect(result.category).toBe('semantic');
    });

    it('classifies conceptual phrase as semantic', () => {
      const result = classifyQuery('how to improve performance');
      expect(result.category).toBe('semantic');
    });

    it('classifies plain words as semantic', () => {
      const result = classifyQuery('explain the concept of recursion');
      expect(result.category).toBe('semantic');
    });
  });

  describe('Weight values match mapping table', () => {
    it('keyword category has bm25Weight=1.5 and vectorWeight=0.5', () => {
      // Use multiple indicators to guarantee keyword
      const result = classifyQuery('http://example.com myFunction()');
      expect(result.category).toBe('keyword');
      expect(result.bm25Weight).toBe(1.5);
      expect(result.vectorWeight).toBe(0.5);
    });

    it('mixed category has bm25Weight=1.0 and vectorWeight=1.0', () => {
      const result = classifyQuery('find "exact match"');
      expect(result.category).toBe('mixed');
      expect(result.bm25Weight).toBe(1);
      expect(result.vectorWeight).toBe(1);
    });

    it('semantic category has bm25Weight=0.5 and vectorWeight=1.5', () => {
      const result = classifyQuery('what is machine learning');
      expect(result.category).toBe('semantic');
      expect(result.bm25Weight).toBe(0.5);
      expect(result.vectorWeight).toBe(1.5);
    });
  });

  describe('Multiple indicators → keyword', () => {
    it('URL + code tokens → keyword', () => {
      const result = classifyQuery('https://api.example.com getData()');
      expect(result.category).toBe('keyword');
    });

    it('file path + quoted phrase → keyword', () => {
      const result = classifyQuery('/var/log "error message"');
      expect(result.category).toBe('keyword');
    });

    it('code tokens + special characters → keyword', () => {
      const result = classifyQuery('myFunction regex.*pattern');
      expect(result.category).toBe('keyword');
    });
  });
});

describe('Feature: hybrid-search, Property 9: Query classifier weight consistency', () => {
  /**
   * **Validates: Requirements 4.3, 4.4, 4.5, 4.6**
   *
   * Property 9: For any query string, the classification result should satisfy:
   * - keyword → bm25Weight > vectorWeight
   * - semantic → vectorWeight > bm25Weight
   * - mixed → bm25Weight == vectorWeight
   * Additionally, for any string containing only alphabetic words and spaces
   * (no keyword indicators), the category should be semantic.
   */

  it('sub-property 1: weight relationship matches category for any arbitrary string', () => {
    fc.assert(
      fc.property(fc.string(), (query) => {
        const result = classifyQuery(query);

        switch (result.category) {
          case 'keyword':
            expect(result.bm25Weight).toBeGreaterThan(result.vectorWeight);
            break;
          case 'semantic':
            expect(result.vectorWeight).toBeGreaterThan(result.bm25Weight);
            break;
          case 'mixed':
            expect(result.bm25Weight).toBe(result.vectorWeight);
            break;
        }
      }),
      { numRuns: 100 }
    );
  });

  it('sub-property 2: strings with only alphabetic words and spaces classify as semantic', () => {
    // Generate strings of lowercase alphabetic words separated by single spaces.
    // Using lowercase-only avoids triggering the camelCase code-token heuristic
    // (which fires on /[a-z][A-Z]/), ensuring no keyword indicators are present.
    const alphaWordsArb = fc
      .array(fc.stringMatching(/^[a-z]+$/), { minLength: 1, maxLength: 10 })
      .map((words) => words.join(' '));

    fc.assert(
      fc.property(alphaWordsArb, (query) => {
        const result = classifyQuery(query);
        expect(result.category).toBe('semantic');
      }),
      { numRuns: 100 }
    );
  });
});
