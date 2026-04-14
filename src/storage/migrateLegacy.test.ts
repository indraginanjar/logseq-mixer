import * as fc from 'fast-check';
import initSqlJs, { type Database } from 'sql.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeEmbedding } from './cosineSimilarity';
import { migrateLegacyOrama } from './migrateLegacy';

/**
 * Build a minimal Orama JSON blob matching the persist('json') structure.
 */
function buildOramaBlob(
  docs: Array<{ id: string; content: string; lastUpdated: number; embedding: number[] }>
): string {
  const docsMap: Record<string, unknown> = {};
  for (let i = 0; i < docs.length; i++) {
    docsMap[`internal_${i}`] = docs[i];
  }
  return JSON.stringify({ data: { docs: { docs: docsMap } } });
}

function setupTables(db: Database): void {
  db.run('CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT)');
  db.run(
    `CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      lastUpdated INTEGER NOT NULL,
      embedding BLOB NOT NULL
    )`
  );
}

describe('migrateLegacyOrama', () => {
  let SQL: Awaited<ReturnType<typeof initSqlJs>>;
  let db: Database;

  beforeEach(async () => {
    SQL = await initSqlJs();
    db = new SQL.Database();
    setupTables(db);
  });

  it('migrates documents from orama_db into documents table', () => {
    const docs = [
      { id: '1', content: 'Hello world', lastUpdated: 1700000000000, embedding: [0.1, 0.2, 0.3] },
      { id: '2', content: 'Second doc', lastUpdated: 1700000001000, embedding: [0.4, 0.5, 0.6] },
    ];
    db.run("INSERT INTO kv_store (key, value) VALUES ('orama_db', ?)", [buildOramaBlob(docs)]);

    const stats = migrateLegacyOrama(db);

    expect(stats.migrated).toBe(2);
    expect(stats.errors).toBe(0);

    // Verify documents are in the table
    const rows = db.exec('SELECT id, content, lastUpdated FROM documents ORDER BY id');
    expect(rows[0].values).toEqual([
      ['1', 'Hello world', 1700000000000],
      ['2', 'Second doc', 1700000001000],
    ]);
  });

  it('deletes orama_db entry after successful migration (Req 6.4)', () => {
    const docs = [{ id: '1', content: 'test', lastUpdated: 1000, embedding: [0.1] }];
    db.run("INSERT INTO kv_store (key, value) VALUES ('orama_db', ?)", [buildOramaBlob(docs)]);

    migrateLegacyOrama(db);

    const result = db.exec("SELECT * FROM kv_store WHERE key = 'orama_db'");
    expect(result.length === 0 || result[0].values.length === 0).toBe(true);
  });

  it('returns zero stats when no orama_db entry exists', () => {
    const stats = migrateLegacyOrama(db);
    expect(stats.migrated).toBe(0);
    expect(stats.errors).toBe(0);
  });

  it('handles corrupted JSON gracefully (Req 6.5)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    db.run("INSERT INTO kv_store (key, value) VALUES ('orama_db', 'not valid json{{{')");

    const stats = migrateLegacyOrama(db);

    expect(stats.migrated).toBe(0);
    expect(stats.errors).toBe(0);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('handles JSON missing data.docs.docs structure', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    db.run("INSERT INTO kv_store (key, value) VALUES ('orama_db', ?)", [
      JSON.stringify({ data: { something: 'else' } }),
    ]);

    const stats = migrateLegacyOrama(db);

    expect(stats.migrated).toBe(0);
    expect(stats.errors).toBe(0);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('continues on individual document extraction failure', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // One valid doc, one with missing embedding
    const blob = JSON.stringify({
      data: {
        docs: {
          docs: {
            a: { id: '1', content: 'good', lastUpdated: 1000, embedding: [0.1, 0.2] },
            b: { id: '2', content: 'bad', lastUpdated: 2000 }, // missing embedding
          },
        },
      },
    });
    db.run("INSERT INTO kv_store (key, value) VALUES ('orama_db', ?)", [blob]);

    const stats = migrateLegacyOrama(db);

    expect(stats.migrated).toBe(1);
    expect(stats.errors).toBe(1);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('preserves embedding data through BLOB round-trip', () => {
    const embedding = [0.0123, -0.456, 0.789, 1.5];
    const docs = [{ id: '1', content: 'test', lastUpdated: 1000, embedding }];
    db.run("INSERT INTO kv_store (key, value) VALUES ('orama_db', ?)", [buildOramaBlob(docs)]);

    migrateLegacyOrama(db);

    const rows = db.exec('SELECT embedding FROM documents WHERE id = ?', ['1']);
    const blob = rows[0].values[0][0] as Uint8Array;
    const decoded = decodeEmbedding(blob);
    expect(decoded.length).toBe(embedding.length);
    for (let i = 0; i < embedding.length; i++) {
      expect(decoded[i]).toBeCloseTo(embedding[i], 5);
    }
  });

  it('handles numeric ids by converting to string', () => {
    const blob = JSON.stringify({
      data: {
        docs: {
          docs: {
            a: { id: 42, content: 'numeric id', lastUpdated: 1000, embedding: [0.1] },
          },
        },
      },
    });
    db.run("INSERT INTO kv_store (key, value) VALUES ('orama_db', ?)", [blob]);

    const stats = migrateLegacyOrama(db);

    expect(stats.migrated).toBe(1);
    const rows = db.exec("SELECT id FROM documents WHERE id = '42'");
    expect(rows[0].values.length).toBe(1);
  });

  it('processes large batches in chunks', () => {
    // Create 1200 docs to test chunking (batch size is 500)
    const docs = Array.from({ length: 1200 }, (_, i) => ({
      id: `doc_${i}`,
      content: `Content ${i}`,
      lastUpdated: 1000 + i,
      embedding: [0.1 * (i + 1)],
    }));
    db.run("INSERT INTO kv_store (key, value) VALUES ('orama_db', ?)", [buildOramaBlob(docs)]);

    const stats = migrateLegacyOrama(db);

    expect(stats.migrated).toBe(1200);
    expect(stats.errors).toBe(0);

    const countResult = db.exec('SELECT COUNT(*) FROM documents');
    expect(countResult[0].values[0][0]).toBe(1200);
  });
});


// Feature: per-document-vector-storage, Property 7: Migration preserves documents
describe('Property 7: Migration preserves documents', () => {
  // **Validates: Requirements 6.2, 6.3**

  let SQL: Awaited<ReturnType<typeof initSqlJs>>;

  beforeEach(async () => {
    SQL = await initSqlJs();
  });

  /**
   * Arbitrary for a single Orama document with a small embedding dimension
   * to keep tests fast. The migration function is dimension-agnostic — it
   * encodes whatever number[] it finds — so small dimensions are valid.
   */
  const oramaDocArb = fc.record({
    id: fc.string({ minLength: 1, maxLength: 20 }),
    content: fc.string({ minLength: 0, maxLength: 100 }),
    lastUpdated: fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
    embedding: fc.array(
      fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
      { minLength: 4, maxLength: 16 }
    ),
  });

  /**
   * Generate 1-5 documents with unique ids (dedup by taking last occurrence).
   */
  const oramaDocsArb = fc
    .array(oramaDocArb, { minLength: 1, maxLength: 5 })
    .map((docs) => {
      // Deduplicate by id — keep last occurrence (same as INSERT OR REPLACE)
      const byId = new Map<string, typeof docs[number]>();
      for (const doc of docs) {
        byId.set(doc.id, doc);
      }
      return [...byId.values()];
    })
    .filter((docs) => docs.length >= 1);

  it('migrating N Orama documents produces N rows with matching fields and intact embeddings', () => {
    fc.assert(
      fc.property(oramaDocsArb, (docs) => {
        const db = new SQL.Database();
        try {
          // Set up tables
          db.run('CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT)');
          db.run(
            `CREATE TABLE IF NOT EXISTS documents (
              id TEXT PRIMARY KEY,
              content TEXT NOT NULL,
              lastUpdated INTEGER NOT NULL,
              embedding BLOB NOT NULL
            )`
          );

          // Build Orama JSON blob with internal ids
          const docsMap: Record<string, unknown> = {};
          for (let i = 0; i < docs.length; i++) {
            docsMap[`internal_${i}`] = docs[i];
          }
          const oramaBlob = JSON.stringify({ data: { docs: { docs: docsMap } } });

          // Insert into kv_store
          db.run("INSERT INTO kv_store (key, value) VALUES ('orama_db', ?)", [oramaBlob]);

          // Run migration
          const stats = migrateLegacyOrama(db);

          // Assert: correct number migrated, no errors
          expect(stats.migrated).toBe(docs.length);
          expect(stats.errors).toBe(0);

          // Assert: N rows in documents table
          const countResult = db.exec('SELECT COUNT(*) FROM documents');
          expect(countResult[0].values[0][0]).toBe(docs.length);

          // Assert: each document's fields match and embedding round-trips correctly
          for (const doc of docs) {
            const rows = db.exec(
              'SELECT id, content, lastUpdated, embedding FROM documents WHERE id = ?',
              [doc.id]
            );
            expect(rows.length).toBe(1);
            expect(rows[0].values.length).toBe(1);

            const [id, content, lastUpdated, embeddingBlob] = rows[0].values[0];
            expect(id).toBe(doc.id);
            expect(content).toBe(doc.content);
            expect(lastUpdated).toBe(doc.lastUpdated);

            // Verify embedding BLOB round-trip integrity
            const decoded = decodeEmbedding(embeddingBlob as Uint8Array);
            expect(decoded.length).toBe(doc.embedding.length);
            for (let i = 0; i < doc.embedding.length; i++) {
              const expected = Math.fround(doc.embedding[i]);
              expect(decoded[i]).toBe(expected);
            }
          }
        } finally {
          db.close();
        }
      }),
      { numRuns: 100 }
    );
  });
});
