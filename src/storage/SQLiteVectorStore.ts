import initSqlJs, { type Database } from 'sql.js';
import type { DocumentRecord, SearchResult, StorageProvider } from './StorageProvider';
import { cosineSimilarity, decodeEmbedding, encodeEmbedding } from './cosineSimilarity';
import { migrateLegacyOrama } from './migrateLegacy';

/**
 * SQLiteVectorStore stores each document embedding as an individual row
 * in a sql.js SQLite database, backed by IndexedDB for persistence.
 *
 * Replaces the monolithic Orama JSON blob approach with per-document
 * CRUD and brute-force cosine similarity search.
 */
export class SQLiteVectorStore implements StorageProvider {
  private _db: Database | null = null;
  private _bulkMode: boolean = false;
  private readonly idbKey: string;
  private static readonly DB_NAME = 'logseq-composer-vectors';
  private static readonly STORE_NAME = 'sqlite';

  constructor(graphPath: string) {
    this.idbKey = `vectors:${graphPath}`;
  }

  /** Expose the underlying sql.js Database for migration access. */
  get db(): Database | null {
    return this._db;
  }

  async initialize(): Promise<void> {
    const basePath = (logseq.baseInfo as any).path ?? '';
    const wasmUrl = this.resolveWasmUrl(basePath);
    console.info(`[SQLiteVectorStore] Loading WASM from: ${wasmUrl}`);

    const SQL = await initSqlJs({
      locateFile: () => wasmUrl,
    });

    // Try to restore from IndexedDB; handle corruption (Req 10.3)
    try {
      const existingData = await this.idbLoad();
      if (existingData) {
        console.info('[SQLiteVectorStore] Restoring database from IndexedDB.');
        this._db = new SQL.Database(new Uint8Array(existingData));
      } else {
        console.info('[SQLiteVectorStore] Creating new database.');
        this._db = new SQL.Database();
      }
    } catch (err) {
      console.warn('[SQLiteVectorStore] IndexedDB data corrupted, creating fresh database.', err);
      this._db = new SQL.Database();
    }

    // Create tables
    this._db.run(
      'CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT)'
    );
    this._db.run(
      `CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        lastUpdated INTEGER NOT NULL,
        embedding BLOB NOT NULL
      )`
    );

    // Migrate legacy Orama blob if present (Req 6.1, 8.3)
    try {
      const result = this._db.exec("SELECT value FROM kv_store WHERE key = 'orama_db'");
      if (result.length > 0 && result[0].values.length > 0) {
        console.info('[SQLiteVectorStore] Legacy orama_db detected, starting migration...');
        const stats = migrateLegacyOrama(this._db);
        console.info(
          `[SQLiteVectorStore] Migration complete: ${stats.migrated} migrated, ${stats.errors} errors.`
        );
        await this.flushWithRetry();
      }
    } catch (err) {
      console.warn('[SQLiteVectorStore] Legacy migration check/run failed:', err);
    }
  }

  /** Enable bulk mode: upsertDocuments and deleteDocuments will skip flushing to IndexedDB. */
  beginBulk(): void {
    this._bulkMode = true;
  }

  /** Disable bulk mode: upsertDocuments and deleteDocuments will resume flushing to IndexedDB. */
  endBulk(): void {
    this._bulkMode = false;
  }

  /** Explicitly persist the in-memory database to IndexedDB. */
  async persistToIndexedDB(): Promise<void> {
    await this.flushWithRetry();
  }

  async upsertDocuments(docs: DocumentRecord[]): Promise<void> {
    if (!this._db) throw new Error('SQLite database not initialized');
    if (docs.length === 0) return;

    this._db.run('BEGIN TRANSACTION');
    for (const doc of docs) {
      try {
        const embeddingBlob = encodeEmbedding(doc.embedding);
        this._db.run(
          'INSERT OR REPLACE INTO documents (id, content, lastUpdated, embedding) VALUES (?, ?, ?, ?)',
          [doc.id, doc.content, doc.lastUpdated, embeddingBlob as any]
        );
      } catch (err) {
        // Req 10.1: log error for single doc, continue with remaining
        console.error(`[SQLiteVectorStore] Failed to upsert document "${doc.id}":`, err);
      }
    }
    this._db.run('COMMIT');
    if (!this._bulkMode) {
      await this.flushWithRetry();
    }
  }

  async deleteDocuments(ids: string[]): Promise<void> {
    if (!this._db) throw new Error('SQLite database not initialized');
    if (ids.length === 0) return;

    const placeholders = ids.map(() => '?').join(', ');
    this._db.run(`DELETE FROM documents WHERE id IN (${placeholders})`, ids);
    if (!this._bulkMode) {
      await this.flushWithRetry();
    }
  }

  async searchByVector(
    queryVector: number[],
    limit: number,
    threshold: number
  ): Promise<SearchResult[]> {
    if (!this._db) throw new Error('SQLite database not initialized');

    const queryF32 = new Float32Array(queryVector);
    const stmt = this._db.prepare('SELECT id, content, embedding FROM documents');

    const results: SearchResult[] = [];

    try {
      while (stmt.step()) {
        const row = stmt.get();
        const id = row[0] as string;
        const content = row[1] as string;
        const embeddingBlob = row[2] as Uint8Array;

        // Req 10.4: validate byte length before using
        if (embeddingBlob.byteLength % 4 !== 0) {
          console.warn(
            `[SQLiteVectorStore] Skipping document "${id}": embedding BLOB has invalid byte length ${embeddingBlob.byteLength}`
          );
          continue;
        }

        const embeddingF32 = decodeEmbedding(embeddingBlob);
        const score = cosineSimilarity(queryF32, embeddingF32);

        if (score >= threshold) {
          results.push({ id, content, score });
        }
      }
    } finally {
      stmt.free();
    }

    // Sort descending by score, return top-limit
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  async getDocumentMeta(id: string): Promise<number | null> {
    if (!this._db) throw new Error('SQLite database not initialized');

    const stmt = this._db.prepare('SELECT lastUpdated FROM documents WHERE id = ?');
    try {
      stmt.bind([id]);
      if (stmt.step()) {
        const row = stmt.get();
        return row[0] as number;
      }
      return null;
    } finally {
      stmt.free();
    }
  }

  /** Retrieve all document IDs and content for BM25 index building. */
  getAllDocumentContent(): Array<{ id: string; content: string }> {
    if (!this._db) return [];

    const stmt = this._db.prepare('SELECT id, content FROM documents');
    const results: Array<{ id: string; content: string }> = [];

    try {
      while (stmt.step()) {
        const row = stmt.get();
        results.push({ id: row[0] as string, content: row[1] as string });
      }
    } finally {
      stmt.free();
    }

    return results;
  }

  async getDocumentCount(): Promise<number> {
    if (!this._db) return 0;
    const result = this._db.exec('SELECT COUNT(*) FROM documents');
    if (result.length > 0 && result[0].values.length > 0) {
      return result[0].values[0][0] as number;
    }
    return 0;
  }

  async clear(): Promise<void> {
    if (!this._db) throw new Error('SQLite database not initialized');
    this._db.run('DELETE FROM documents');
    // Reclaim disk space so the exported file reflects the actual data size
    this._db.run('VACUUM');
    await this.flushWithRetry();
  }

  /** Export the SQLite database as a file download (vectors.sqlite) */
  exportToFile(): void {
    if (!this._db) throw new Error('SQLite database not initialized');
    const data = this._db.export();
    const blob = new Blob([data], { type: 'application/x-sqlite3' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'vectors.sqlite';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  /** Get the stored chunking version, or null if not set. */
  getChunkingVersion(): string | null {
    if (!this._db) throw new Error('SQLite database not initialized');
    const result = this._db.exec(
      "SELECT value FROM kv_store WHERE key = 'chunking_version'"
    );
    if (result.length > 0 && result[0].values.length > 0) {
      return result[0].values[0][0] as string;
    }
    return null;
  }

  /** Set the chunking version. */
  setChunkingVersion(version: string): void {
    if (!this._db) throw new Error('SQLite database not initialized');
    this._db.run(
      "INSERT OR REPLACE INTO kv_store (key, value) VALUES ('chunking_version', ?)",
      [version]
    );
  }

  // --- Private helpers ---

  /** Flush with retry: retry once on failure, log error on second failure (Req 10.2) */
  private async flushWithRetry(): Promise<void> {
    try {
      await this.flush();
    } catch (err) {
      console.warn('[SQLiteVectorStore] IndexedDB flush failed, retrying once...', err);
      try {
        await this.flush();
      } catch (error_) {
        console.error('[SQLiteVectorStore] IndexedDB flush retry failed:', error_);
      }
    }
  }

  /** Persist the in-memory database to IndexedDB */
  private async flush(): Promise<void> {
    if (!this._db) return;
    const data = this._db.export();
    await this.idbSave(data.buffer);
  }

  /** Resolve the WASM binary URL for sql.js */
  private resolveWasmUrl(basePath: string): string {
    if (basePath) {
      return `file://${basePath.replaceAll('\\', '/')}/dist/sql-wasm.wasm`;
    }
    return 'sql-wasm.wasm';
  }

  // --- IndexedDB helpers ---

  private openIDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(SQLiteVectorStore.DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(SQLiteVectorStore.STORE_NAME)) {
          db.createObjectStore(SQLiteVectorStore.STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  private async idbSave(buffer: ArrayBuffer): Promise<void> {
    const db = await this.openIDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SQLiteVectorStore.STORE_NAME, 'readwrite');
      const store = tx.objectStore(SQLiteVectorStore.STORE_NAME);
      store.put(buffer, this.idbKey);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }

  private async idbLoad(): Promise<ArrayBuffer | null> {
    const db = await this.openIDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SQLiteVectorStore.STORE_NAME, 'readonly');
      const store = tx.objectStore(SQLiteVectorStore.STORE_NAME);
      const request = store.get(this.idbKey);
      request.onsuccess = () => { db.close(); resolve(request.result ?? null); };
      request.onerror = () => { db.close(); reject(request.error); };
    });
  }
}
