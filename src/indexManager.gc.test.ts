import * as fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import initSqlJs from 'sql.js';
import { _resetIndexingState, purgeDeletedPages, setIndexManagerBM25 } from './indexManager';
import { SQLiteVectorStore } from './storage/SQLiteVectorStore';
import { BM25Index } from './bm25Index';

// Mock embedManager to prevent import errors (indexManager imports it)
vi.mock('./embedManager', () => ({
  DEFAULT_EMBEDDING_MODEL: 'text-embedding-3-small',
  extractOutgoingLinks: () => [],
  fetchBacklinks: async () => [],
  getEmbeddingsForPage: async () => ({ embeddings: [], blockMetadata: [], chunkDepthMetadata: [] }),
  PageLinkData: {},
}));

afterEach(() => {
  _resetIndexingState();
});

/**
 * Helper: create a SQLiteVectorStore backed by an in-memory sql.js database,
 * bypassing IndexedDB and logseq globals entirely.
 */
async function createInMemoryStore(): Promise<SQLiteVectorStore> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();

  db.run('CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT)');
  db.run(
    `CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      lastUpdated INTEGER NOT NULL,
      embedding BLOB NOT NULL,
      root_depth INTEGER NOT NULL DEFAULT 0,
      has_heading INTEGER NOT NULL DEFAULT 0
    )`
  );
  db.run(
    `CREATE TABLE IF NOT EXISTS block_metadata (
      uuid TEXT PRIMARY KEY,
      pageName TEXT NOT NULL,
      contentPreview TEXT NOT NULL
    )`
  );

  const store = new SQLiteVectorStore('test-graph');
  (store as any)._db = db;
  (store as any).flushWithRetry = async () => {};
  return store;
}

/** Insert a document with a note_name header matching the page name convention. */
function insertDoc(store: SQLiteVectorStore, id: string, pageName: string, lastUpdated = 1000) {
  const content = `note_id: ${id.split('_chunk_')[0]}\nnote_name: ${pageName}\nnote_content:\n\nSome content for ${pageName}`;
  const embedding = new Uint8Array(new Float32Array([0.1, 0.2, 0.3]).buffer);
  const db = (store as any)._db;
  db.run(
    'INSERT OR REPLACE INTO documents (id, content, lastUpdated, embedding) VALUES (?, ?, ?, ?)',
    [id, content, lastUpdated, embedding]
  );
}

/** Insert a block_metadata entry. */
function insertBlockMeta(store: SQLiteVectorStore, uuid: string, pageName: string, preview: string) {
  const db = (store as any)._db;
  db.run(
    'INSERT OR REPLACE INTO block_metadata (uuid, pageName, contentPreview) VALUES (?, ?, ?)',
    [uuid, pageName, preview]
  );
}

/** Get all document IDs from the store. */
function getAllDocIds(store: SQLiteVectorStore): string[] {
  const db = (store as any)._db;
  const result = db.exec('SELECT id FROM documents');
  if (result.length === 0) return [];
  return result[0].values.map((row: any) => row[0] as string);
}

/** Get all block_metadata page names. */
function getAllBlockMetaPageNames(store: SQLiteVectorStore): string[] {
  const db = (store as any)._db;
  const result = db.exec('SELECT DISTINCT pageName FROM block_metadata');
  if (result.length === 0) return [];
  return result[0].values.map((row: any) => row[0] as string);
}

describe('purgeDeletedPages — garbage collection of stale index entries', () => {
  let store: SQLiteVectorStore;

  beforeEach(async () => {
    store = await createInMemoryStore();
  });

  afterEach(() => {
    const db = store.db;
    if (db) db.close();
  });

  it('does nothing when all indexed pages still exist', async () => {
    // Index pages 1, 2, 3
    insertDoc(store, '1', 'Page One');
    insertDoc(store, '2', 'Page Two');
    insertDoc(store, '3', 'Page Three');

    const existingPages = [
      { id: 1, name: 'Page One' },
      { id: 2, name: 'Page Two' },
      { id: 3, name: 'Page Three' },
    ];

    const purged = purgeDeletedPages(existingPages, store as any);

    expect(purged).toBe(0);
    expect(getAllDocIds(store)).toHaveLength(3);
  });

  it('purges chunks from a deleted page (single chunk)', async () => {
    // Index pages 1, 2, 3
    insertDoc(store, '1', 'Page One');
    insertDoc(store, '2', 'Page Two');
    insertDoc(store, '3', 'Page Three');
    insertBlockMeta(store, 'block-uuid-1', 'Page One', 'preview 1');
    insertBlockMeta(store, 'block-uuid-2', 'Page Two', 'preview 2');

    // Page 2 has been deleted from the graph
    const existingPages = [
      { id: 1, name: 'Page One' },
      { id: 3, name: 'Page Three' },
    ];

    const purged = purgeDeletedPages(existingPages, store as any);

    expect(purged).toBe(1);
    const remainingIds = getAllDocIds(store);
    expect(remainingIds).toContain('1');
    expect(remainingIds).toContain('3');
    expect(remainingIds).not.toContain('2');

    // Block metadata for Page Two should be deleted
    const remainingMeta = getAllBlockMetaPageNames(store);
    expect(remainingMeta).toContain('Page One');
    expect(remainingMeta).not.toContain('Page Two');
  });

  it('purges chunks from a deleted page (multi-chunk)', async () => {
    // Page 10 has 3 chunks
    insertDoc(store, '10', 'Multi Page');
    insertDoc(store, '10_chunk_1', 'Multi Page');
    insertDoc(store, '10_chunk_2', 'Multi Page');
    // Page 20 exists
    insertDoc(store, '20', 'Remaining Page');

    insertBlockMeta(store, 'b1', 'Multi Page', 'preview');
    insertBlockMeta(store, 'b2', 'Remaining Page', 'preview');

    // Only page 20 still exists
    const existingPages = [{ id: 20, name: 'Remaining Page' }];

    const purged = purgeDeletedPages(existingPages, store as any);

    expect(purged).toBe(1);
    const remainingIds = getAllDocIds(store);
    expect(remainingIds).toEqual(['20']);

    const remainingMeta = getAllBlockMetaPageNames(store);
    expect(remainingMeta).toEqual(['Remaining Page']);
  });

  it('removes entries from BM25 index during purge', async () => {
    insertDoc(store, '1', 'Page One');
    insertDoc(store, '2', 'Page Two');

    // Set up a real BM25 index
    const bm25 = new BM25Index();
    bm25.upsertDocuments([
      { id: '1', content: 'content of page one' },
      { id: '2', content: 'content of page two' },
    ]);
    setIndexManagerBM25(bm25);

    // Page 2 deleted
    const existingPages = [{ id: 1, name: 'Page One' }];

    const purged = purgeDeletedPages(existingPages, store as any);

    expect(purged).toBe(1);

    // BM25 should no longer find page 2 content
    const results = bm25.search('page two', 10);
    expect(results.every(r => r.id !== '2')).toBe(true);

    // BM25 should still find page 1 content
    const results1 = bm25.search('page one', 10);
    expect(results1.some(r => r.id === '1')).toBe(true);

    // Clean up
    setIndexManagerBM25(null);
  });

  it('removes entries from HNSW accelerator during purge', async () => {
    insertDoc(store, '1', 'Page One');
    insertDoc(store, '2', 'Page Two');

    const removeVectorsSpy = vi.fn();
    const mockAccelerator = { removeVectors: removeVectorsSpy } as any;

    const existingPages = [{ id: 1, name: 'Page One' }];

    purgeDeletedPages(existingPages, store as any, mockAccelerator);

    expect(removeVectorsSpy).toHaveBeenCalledWith(['2']);
  });

  it('returns 0 and does not modify store when no indexed pages exist', async () => {
    const existingPages = [{ id: 1, name: 'Page One' }];
    const purged = purgeDeletedPages(existingPages, store as any);
    expect(purged).toBe(0);
    expect(getAllDocIds(store)).toHaveLength(0);
  });

  it('handles multiple deleted pages at once', async () => {
    // Index 5 pages
    for (let i = 1; i <= 5; i++) {
      insertDoc(store, String(i), `Page ${i}`);
      insertBlockMeta(store, `block-${i}`, `Page ${i}`, `preview ${i}`);
    }

    // Only pages 2 and 4 remain
    const existingPages = [
      { id: 2, name: 'Page 2' },
      { id: 4, name: 'Page 4' },
    ];

    const purged = purgeDeletedPages(existingPages, store as any);

    expect(purged).toBe(3); // pages 1, 3, 5 purged
    const remainingIds = getAllDocIds(store);
    expect(remainingIds.sort()).toEqual(['2', '4']);

    const remainingMeta = getAllBlockMetaPageNames(store);
    expect(remainingMeta.sort()).toEqual(['Page 2', 'Page 4']);
  });

  it('property: purge never removes pages that still exist in the graph', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate a random set of indexed page IDs and a subset that still exist
        fc.integer({ min: 1, max: 20 }).chain(totalPages =>
          fc.tuple(
            fc.constant(totalPages),
            fc.array(fc.integer({ min: 0, max: totalPages - 1 }), { minLength: 0, maxLength: totalPages })
          )
        ),
        async ([totalPages, deletedIndices]) => {
          const freshStore = await createInMemoryStore();

          try {
            // Insert documents for all pages
            for (let i = 1; i <= totalPages; i++) {
              insertDoc(freshStore, String(i), `Page ${i}`);
            }

            // Determine which pages still exist (not deleted)
            const deletedSet = new Set(deletedIndices.map(i => i + 1));
            const existingPages = [];
            for (let i = 1; i <= totalPages; i++) {
              if (!deletedSet.has(i)) {
                existingPages.push({ id: i, name: `Page ${i}` });
              }
            }

            purgeDeletedPages(existingPages, freshStore as any);

            // Verify: all existing page documents are still present
            const remainingIds = new Set(getAllDocIds(freshStore));
            for (const page of existingPages) {
              expect(remainingIds.has(String(page.id))).toBe(true);
            }

            // Verify: no deleted page documents remain
            for (const deletedId of deletedSet) {
              expect(remainingIds.has(String(deletedId))).toBe(false);
            }
          } finally {
            const db = freshStore.db;
            if (db) db.close();
          }
        }
      ),
      { numRuns: 50 }
    );
  }, 30_000);
});
