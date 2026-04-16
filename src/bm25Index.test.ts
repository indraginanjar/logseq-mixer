import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BM25Index } from './bm25Index';

describe('BM25Index.tokenize', () => {
  it('returns empty array for empty string', () => {
    expect(BM25Index.tokenize('')).toEqual([]);
  });

  it('returns empty array for punctuation-only input', () => {
    // The regex splits on \p{P} (Unicode punctuation) — $, ^, @, #, & are Unicode symbols (\p{S}), not punctuation
    expect(BM25Index.tokenize('!().,;:?')).toEqual([]);
  });

  it('converts tokens to lowercase', () => {
    expect(BM25Index.tokenize('Hello WORLD FoO')).toEqual(['hello', 'world', 'foo']);
  });

  it('splits on whitespace and punctuation', () => {
    expect(BM25Index.tokenize('hello, world! foo-bar')).toEqual(['hello', 'world', 'foo', 'bar']);
  });

  it('handles unicode characters correctly', () => {
    const tokens = BM25Index.tokenize('café résumé naïve');
    expect(tokens).toEqual(['café', 'résumé', 'naïve']);
  });

  it('handles mixed unicode and ASCII', () => {
    const tokens = BM25Index.tokenize('日本語 テスト hello');
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens).toContain('hello');
  });
});

describe('BM25Index.search', () => {
  it('returns empty results on an empty index', () => {
    const index = new BM25Index();
    expect(index.search('anything', 10)).toEqual([]);
  });

  it('returns the matching document for a single-doc single-term query', () => {
    const index = new BM25Index();
    index.buildFromDocuments([{ id: 'doc1', content: 'the quick brown fox' }]);

    const results = index.search('fox', 5);
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('doc1');
    expect(results[0].score).toBeGreaterThan(0);
  });

  it('scores document with more occurrences of query term higher', () => {
    const index = new BM25Index();
    index.buildFromDocuments([
      { id: 'low', content: 'the fox jumped over the fence' },
      { id: 'high', content: 'the fox saw another fox and the fox ran' },
    ]);

    const results = index.search('fox', 5);
    expect(results.length).toBe(2);
    expect(results[0].id).toBe('high');
    expect(results[1].id).toBe('low');
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  it('returns empty results for an empty query', () => {
    const index = new BM25Index();
    index.buildFromDocuments([{ id: 'doc1', content: 'hello world' }]);
    expect(index.search('', 5)).toEqual([]);
  });

  it('returns empty results for a punctuation-only query', () => {
    const index = new BM25Index();
    index.buildFromDocuments([{ id: 'doc1', content: 'hello world' }]);
    expect(index.search('!!!...', 5)).toEqual([]);
  });

  it('returns empty results when no documents match the query', () => {
    const index = new BM25Index();
    index.buildFromDocuments([{ id: 'doc1', content: 'hello world' }]);
    expect(index.search('nonexistent', 5)).toEqual([]);
  });

  it('respects the limit parameter', () => {
    const index = new BM25Index();
    index.buildFromDocuments([
      { id: 'a', content: 'test document one test' },
      { id: 'b', content: 'test document two test' },
      { id: 'c', content: 'test document three test' },
    ]);

    const results = index.search('test', 2);
    expect(results.length).toBe(2);
  });
});

describe('BM25Index lifecycle', () => {
  it('upsertDocuments adds searchable documents', () => {
    const index = new BM25Index();
    index.upsertDocuments([{ id: 'doc1', content: 'alpha beta gamma' }]);

    const results = index.search('alpha', 5);
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('doc1');
  });

  it('upsertDocuments updates existing documents', () => {
    const index = new BM25Index();
    index.upsertDocuments([{ id: 'doc1', content: 'old content here' }]);
    index.upsertDocuments([{ id: 'doc1', content: 'new content here' }]);

    expect(index.search('old', 5)).toEqual([]);

    const results = index.search('new', 5);
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('doc1');
  });

  it('removeDocuments makes documents unsearchable', () => {
    const index = new BM25Index();
    index.buildFromDocuments([
      { id: 'doc1', content: 'alpha beta' },
      { id: 'doc2', content: 'gamma delta' },
    ]);

    index.removeDocuments(['doc1']);

    expect(index.search('alpha', 5)).toEqual([]);
    const results = index.search('gamma', 5);
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('doc2');
  });

  it('removeDocuments is a no-op for non-existent IDs', () => {
    const index = new BM25Index();
    index.buildFromDocuments([{ id: 'doc1', content: 'hello world' }]);

    index.removeDocuments(['nonexistent']);

    const results = index.search('hello', 5);
    expect(results.length).toBe(1);
  });

  it('clear empties the index completely', () => {
    const index = new BM25Index();
    index.buildFromDocuments([
      { id: 'doc1', content: 'hello world' },
      { id: 'doc2', content: 'foo bar' },
    ]);

    index.clear();

    expect(index.search('hello', 5)).toEqual([]);
    expect(index.search('foo', 5)).toEqual([]);
  });

  it('index is usable after clear and rebuild', () => {
    const index = new BM25Index();
    index.buildFromDocuments([{ id: 'doc1', content: 'first pass' }]);
    index.clear();
    index.buildFromDocuments([{ id: 'doc2', content: 'second pass' }]);

    expect(index.search('first', 5)).toEqual([]);
    const results = index.search('second', 5);
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('doc2');
  });
});

describe('Feature: hybrid-search, Property 2: BM25 positive score for matching documents', () => {
  /**
   * **Validates: Requirements 1.4**
   *
   * For any non-empty set of documents and any query where at least one document
   * contains a query term as a substring, the BM25 index should assign a positive
   * score (> 0) to at least one document in the result set.
   */
  it('at least one result has a positive score when a document contains a query term', () => {
    // Generate a non-empty array of non-empty-content documents, then pick a token
    // from one of them to guarantee at least one doc contains the query term.
    const arbDocsAndQuery = fc
      .array(
        fc.record({
          id: fc.stringMatching(/^[a-z][a-z0-9]{0,9}$/),
          content: fc.stringMatching(/^[a-z]{1,5}( [a-z]{1,5}){0,9}$/),
        }),
        { minLength: 1, maxLength: 10 }
      )
      .chain((docs) => {
        // Deduplicate by id
        const uniqueDocs = Array.from(new Map(docs.map((d) => [d.id, d])).values());
        if (uniqueDocs.length === 0) return fc.constant(null);

        // Collect all tokens across all documents
        const allTokens = uniqueDocs.flatMap((d) => BM25Index.tokenize(d.content));
        if (allTokens.length === 0) return fc.constant(null);

        // Pick one token to use as the query
        return fc.constantFrom(...allTokens).map((queryTerm) => ({
          docs: uniqueDocs,
          query: queryTerm,
        }));
      })
      .filter((v): v is { docs: Array<{ id: string; content: string }>; query: string } => v !== null);

    fc.assert(
      fc.property(arbDocsAndQuery, ({ docs, query }) => {
        const index = new BM25Index();
        index.buildFromDocuments(docs);

        const results = index.search(query, docs.length);

        // At least one result must have a positive score
        expect(results.length).toBeGreaterThanOrEqual(1);
        expect(results.some((r) => r.score > 0)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });
});

describe('Feature: hybrid-search, Property 3: BM25 empty query returns empty results', () => {
  /**
   * **Validates: Requirements 1.5**
   *
   * For any string composed entirely of whitespace and/or punctuation characters
   * (producing zero tokens after tokenization), BM25Index.search() should return
   * an empty result list.
   */
  it('returns empty results for any query that tokenizes to zero tokens', () => {
    // Generate strings composed entirely of whitespace and/or punctuation characters.
    // These produce zero tokens after BM25Index.tokenize().
    // Use explicit punctuation chars since fast-check doesn't support \p{P} in stringMatching.
    const whitespaceAndPunctuation = fc.stringMatching(
      /^[\s!-\/:-@\[-`{-~\u00A1\u00AB\u00AD\u00B7\u00BB\u00BF\u2010-\u2027\u2030-\u205E]{0,50}$/
    );

    // Build an index with some real documents so the index is non-empty
    const index = new BM25Index();
    index.buildFromDocuments([
      { id: 'doc1', content: 'the quick brown fox jumps over the lazy dog' },
      { id: 'doc2', content: 'hello world this is a test document' },
      { id: 'doc3', content: 'typescript javascript programming language' },
    ]);

    fc.assert(
      fc.property(whitespaceAndPunctuation, (query) => {
        const results = index.search(query, 10);
        expect(results).toEqual([]);
      }),
      { numRuns: 100 }
    );
  });
});

describe('Feature: hybrid-search, Property 1: Tokenizer produces lowercase tokens without whitespace or punctuation', () => {
  /**
   * **Validates: Requirements 1.2**
   *
   * For any input string, every token produced by BM25Index.tokenize() should be
   * entirely lowercase, contain no whitespace characters, and contain no punctuation characters.
   */
  it('every token is lowercase, has no whitespace, and has no punctuation', () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        const tokens = BM25Index.tokenize(input);

        for (const token of tokens) {
          // Token must be lowercase
          expect(token).toBe(token.toLowerCase());

          // Token must not contain whitespace
          expect(token).not.toMatch(/\s/);

          // Token must not contain Unicode punctuation
          expect(token).not.toMatch(/\p{P}/u);
        }
      }),
      { numRuns: 100 }
    );
  });
});

describe('Feature: hybrid-search, Property 4: BM25 result count respects limit', () => {
  /**
   * **Validates: Requirements 1.3**
   *
   * For any set of documents and any query with a specified limit K, the number
   * of results returned by BM25Index.search() should be less than or equal to K.
   */
  it('result count is always <= the specified limit K', () => {
    fc.assert(
      fc.property(
        // Generate a non-empty array of documents with content
        fc.array(
          fc.record({
            id: fc.stringMatching(/^[a-z][a-z0-9]{0,9}$/),
            content: fc.stringMatching(/^[a-z]{1,5}( [a-z]{1,5}){0,9}$/),
          }),
          { minLength: 1, maxLength: 15 }
        ),
        // Generate a query string (arbitrary — may or may not match docs)
        fc.stringMatching(/^[a-z]{1,5}( [a-z]{1,5}){0,4}$/),
        // Generate a positive integer limit K between 1 and 20
        fc.integer({ min: 1, max: 20 }),
        (docs, query, limit) => {
          // Deduplicate by id so buildFromDocuments doesn't silently overwrite
          const uniqueDocs = Array.from(new Map(docs.map((d) => [d.id, d])).values());
          if (uniqueDocs.length === 0) return;

          const index = new BM25Index();
          index.buildFromDocuments(uniqueDocs);

          const results = index.search(query, limit);

          expect(results.length).toBeLessThanOrEqual(limit);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Feature: hybrid-search, Property 5: BM25 index upsert/delete consistency', () => {
  /**
   * **Validates: Requirements 2.2, 2.3**
   *
   * For any sequence of document upserts followed by deletions on a BM25 index,
   * searching for a unique term from a deleted document should not return that document,
   * and searching for a unique term from a non-deleted document should return it.
   */
  it('deleted documents are not found and non-deleted documents are found by their unique terms', () => {
    fc.assert(
      fc.property(
        // Generate between 2 and 15 documents, each with some extra words
        fc.integer({ min: 2, max: 15 }).chain((docCount) => {
          return fc
            .array(
              fc.stringMatching(/^[a-z]{1,4}( [a-z]{1,4}){0,5}$/),
              { minLength: docCount, maxLength: docCount }
            )
            .chain((extraContents) => {
              // Generate a non-empty subset of indices to delete
              const allIndices = Array.from({ length: docCount }, (_, i) => i);
              return fc
                .subarray(allIndices, { minLength: 1, maxLength: docCount - 1 })
                .map((deleteIndices) => {
                  const deleteSet = new Set(deleteIndices);
                  // Build documents, each with a unique identifier term
                  const docs = Array.from({ length: docCount }, (_, i) => ({
                    id: `doc${i}`,
                    content: `uniqueterm_doc${i} ${extraContents[i]}`,
                  }));
                  return {
                    docs,
                    deleteIds: deleteIndices.map((i) => `doc${i}`),
                    deletedIndices: deleteSet,
                    docCount,
                  };
                });
            });
        }),
        ({ docs, deleteIds, deletedIndices, docCount }) => {
          const index = new BM25Index();

          // Upsert all documents
          index.upsertDocuments(docs);

          // Delete the selected subset
          index.removeDocuments(deleteIds);

          // For each deleted document, searching its unique term should NOT return it
          for (const delIdx of deletedIndices) {
            const results = index.search(`uniqueterm_doc${delIdx}`, docCount);
            const foundIds = results.map((r) => r.id);
            expect(foundIds).not.toContain(`doc${delIdx}`);
          }

          // For each non-deleted document, searching its unique term SHOULD return it
          for (let i = 0; i < docCount; i++) {
            if (!deletedIndices.has(i)) {
              const results = index.search(`uniqueterm_doc${i}`, docCount);
              const foundIds = results.map((r) => r.id);
              expect(foundIds).toContain(`doc${i}`);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
