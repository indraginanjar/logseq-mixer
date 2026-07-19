import initSqlJs, { type Database } from 'sql.js';
import type { DocumentRecord, SearchResult, StorageProvider } from './StorageProvider';
import { cosineSimilarity, decodeEmbedding, encodeEmbedding } from './cosineSimilarity';
import { migrateLegacyOrama } from './migrateLegacy';

export interface DocumentRecordWithDepth extends DocumentRecord {
  rootDepth: number;
  hasHeading: boolean;
}

/**
 * SQLiteVectorStore stores each document embedding as an individual row
 * in a sql.js SQLite database, backed by IndexedDB for persistence.
 *
 * Replaces the monolithic Orama JSON blob approach with per-document
 * CRUD and brute-force cosine similarity search.
 */
export class SQLiteVectorStore implements StorageProvider {
  private _db: Database | null = null;
  private _SQL: any = null;
  private _bulkMode: boolean = false;
  private readonly idbKey: string;
  private static readonly DB_NAME = 'logseq-mixer-vectors';
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

    this._SQL = await initSqlJs({
      locateFile: () => wasmUrl,
    });
    const SQL = this._SQL;

    // Yield to the event loop so the host app stays responsive during startup
    await new Promise(resolve => setTimeout(resolve, 0));

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

    // Yield after heavy database parsing so the host app can process messages
    await new Promise(resolve => setTimeout(resolve, 0));

    if (!this._db) {
      throw new Error('[SQLiteVectorStore] Database initialization failed.');
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
        embedding BLOB NOT NULL,
        root_depth INTEGER NOT NULL DEFAULT 0,
        has_heading INTEGER NOT NULL DEFAULT 0
      )`
    );
    this._db.run(
      `CREATE TABLE IF NOT EXISTS block_metadata (
        uuid TEXT PRIMARY KEY,
        pageName TEXT NOT NULL,
        contentPreview TEXT NOT NULL
      )`
    );
    this._db.run(
      `CREATE TABLE IF NOT EXISTS agent_memory (
        id TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_accessed INTEGER,
        source TEXT,
        metadata TEXT
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

    // Check for exact ID first (single-chunk pages), then fall back to
    // chunk_0 (multi-chunk pages store as pageId_chunk_0, pageId_chunk_1, etc.)
    const stmt = this._db.prepare(
      'SELECT lastUpdated FROM documents WHERE id = ? OR id = ? LIMIT 1'
    );
    try {
      stmt.bind([id, `${id}_chunk_0`]);
      if (stmt.step()) {
        const row = stmt.get();
        return row[0] as number;
      }
      return null;
    } finally {
      stmt.free();
    }
  }

  /** Retrieve all document IDs, content, and raw embedding BLOBs for HNSW index construction. */
  getAllEmbeddings(): Array<{ id: string; content: string; embedding: Uint8Array }> {
    if (!this._db) return [];

    const stmt = this._db.prepare('SELECT id, content, embedding FROM documents');
    const results: Array<{ id: string; content: string; embedding: Uint8Array }> = [];

    try {
      while (stmt.step()) {
        const row = stmt.get();
        results.push({
          id: row[0] as string,
          content: row[1] as string,
          embedding: row[2] as Uint8Array,
        });
      }
    } finally {
      stmt.free();
    }

    return results;
  }

  /** Fetch document content by IDs (used if content cache needs refresh). */
  getDocumentContent(ids: string[]): Map<string, string> {
    if (!this._db || ids.length === 0) return new Map();

    const placeholders = ids.map(() => '?').join(', ');
    const stmt = this._db.prepare(
      `SELECT id, content FROM documents WHERE id IN (${placeholders})`
    );
    const result = new Map<string, string>();

    try {
      stmt.bind(ids);
      while (stmt.step()) {
        const row = stmt.get();
        result.set(row[0] as string, row[1] as string);
      }
    } finally {
      stmt.free();
    }

    return result;
  }

  /** Get root_depth and has_heading for a set of document IDs. */
  getDepthMetadata(ids: string[]): Map<string, { rootDepth: number; hasHeading: boolean }> {
    if (!this._db || ids.length === 0) return new Map();

    const placeholders = ids.map(() => '?').join(', ');
    const stmt = this._db.prepare(
      `SELECT id, root_depth, has_heading FROM documents WHERE id IN (${placeholders})`
    );
    const result = new Map<string, { rootDepth: number; hasHeading: boolean }>();

    try {
      stmt.bind(ids);
      while (stmt.step()) {
        const row = stmt.get();
        result.set(row[0] as string, {
          rootDepth: row[1] as number,
          hasHeading: (row[2] as number) === 1,
        });
      }
    } finally {
      stmt.free();
    }

    return result;
  }

  /** Upsert documents with extended metadata (root_depth, has_heading). */
  async upsertDocumentsWithDepth(docs: DocumentRecordWithDepth[]): Promise<void> {
    if (!this._db) throw new Error('SQLite database not initialized');
    if (docs.length === 0) return;

    this._db.run('BEGIN TRANSACTION');
    for (const doc of docs) {
      try {
        const embeddingBlob = encodeEmbedding(doc.embedding);
        this._db.run(
          'INSERT OR REPLACE INTO documents (id, content, lastUpdated, embedding, root_depth, has_heading) VALUES (?, ?, ?, ?, ?, ?)',
          [doc.id, doc.content, doc.lastUpdated, embeddingBlob as any, doc.rootDepth, doc.hasHeading ? 1 : 0]
        );
      } catch (err) {
        console.error(`[SQLiteVectorStore] Failed to upsert document with depth "${doc.id}":`, err);
      }
    }
    this._db.run('COMMIT');
    if (!this._bulkMode) {
      await this.flushWithRetry();
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

  async getPageCount(): Promise<number> {
    if (!this._db) return 0;
    const result = this._db.exec(
      "SELECT COUNT(DISTINCT CASE WHEN INSTR(id, '_chunk_') > 0 THEN SUBSTR(id, 1, INSTR(id, '_chunk_') - 1) ELSE id END) FROM documents"
    );
    if (result.length > 0 && result[0].values.length > 0) {
      return result[0].values[0][0] as number;
    }
    return 0;
  }

  /**
   * Return the set of distinct page IDs that have indexed documents.
   * Strips the `_chunk_N` suffix from chunk IDs to recover the original page ID.
   * Used by the garbage collection step to detect stale entries from deleted pages.
   */
  getIndexedPageIds(): Set<string> {
    if (!this._db) return new Set();
    const result = this._db.exec(
      "SELECT DISTINCT CASE WHEN INSTR(id, '_chunk_') > 0 THEN SUBSTR(id, 1, INSTR(id, '_chunk_') - 1) ELSE id END AS page_id FROM documents"
    );
    const ids = new Set<string>();
    if (result.length > 0) {
      for (const row of result[0].values) {
        ids.add(row[0] as string);
      }
    }
    return ids;
  }

  /**
   * Return all document IDs (chunk IDs) belonging to a given page ID.
   * Matches both the bare page ID and any `{pageId}_chunk_N` entries.
   */
  getDocumentIdsForPage(pageId: string): string[] {
    if (!this._db) return [];
    const stmt = this._db.prepare(
      "SELECT id FROM documents WHERE id = ? OR id LIKE ? || '_chunk_%'"
    );
    const ids: string[] = [];
    try {
      stmt.bind([pageId, pageId]);
      while (stmt.step()) {
        ids.push(stmt.get()[0] as string);
      }
    } finally {
      stmt.free();
    }
    return ids;
  }

  /**
   * Extract the page name from the first document chunk for a given page ID.
   * Parses the `note_name:` header line from the chunk content.
   * Returns null if no document is found or the header is missing.
   */
  getPageNameForPageId(pageId: string): string | null {
    if (!this._db) return null;
    const stmt = this._db.prepare('SELECT content FROM documents WHERE id = ? LIMIT 1');
    try {
      stmt.bind([pageId]);
      if (stmt.step()) {
        const content = stmt.get()[0] as string;
        const match = content.match(/note_name:\s*(.+)/);
        return match ? match[1].trim() : null;
      }
      // Try the first chunk variant
      stmt.free();
      const chunkStmt = this._db.prepare("SELECT content FROM documents WHERE id LIKE ? || '_chunk_%' LIMIT 1");
      try {
        chunkStmt.bind([pageId]);
        if (chunkStmt.step()) {
          const content = chunkStmt.get()[0] as string;
          const match = content.match(/note_name:\s*(.+)/);
          return match ? match[1].trim() : null;
        }
      } finally {
        chunkStmt.free();
      }
      return null;
    } finally {
      stmt.free();
    }
  }

  async clear(): Promise<void> {
    if (!this._db) throw new Error('SQLite database not initialized');
    this._db.run('DELETE FROM documents');
    this._db.run('DELETE FROM block_metadata');
    // Reclaim disk space so the exported file reflects the actual data size
    this._db.run('VACUUM');
    await this.flushWithRetry();
  }

  /** Upsert block metadata records (called during indexing). */
  upsertBlockMetadata(entries: Array<{ uuid: string; pageName: string; contentPreview: string }>): void {
    if (!this._db) throw new Error('SQLite database not initialized');
    if (entries.length === 0) return;

    this._db.run('BEGIN TRANSACTION');
    for (const entry of entries) {
      this._db.run(
        'INSERT OR REPLACE INTO block_metadata (uuid, pageName, contentPreview) VALUES (?, ?, ?)',
        [entry.uuid, entry.pageName, entry.contentPreview]
      );
    }
    this._db.run('COMMIT');
  }

  /** Delete all block metadata for a given page (called before re-indexing a page). */
  deleteBlockMetadataForPage(pageName: string): void {
    if (!this._db) throw new Error('SQLite database not initialized');
    this._db.run('DELETE FROM block_metadata WHERE pageName = ?', [pageName]);
  }

  /** Delete block metadata for multiple pages at once (called during GC purge). */
  deleteBlockMetadataForPages(pageNames: string[]): void {
    if (!this._db) throw new Error('SQLite database not initialized');
    if (pageNames.length === 0) return;
    const placeholders = pageNames.map(() => '?').join(', ');
    this._db.run(`DELETE FROM block_metadata WHERE pageName IN (${placeholders})`, pageNames);
  }

  /** Clear all block metadata (called on full re-index). */
  clearBlockMetadata(): void {
    if (!this._db) throw new Error('SQLite database not initialized');
    this._db.run('DELETE FROM block_metadata');
  }

  /** Look up a single block's metadata by UUID. Returns null if not found. */
  getBlockMetadata(uuid: string): { pageName: string; contentPreview: string } | null {
    if (!this._db) throw new Error('SQLite database not initialized');

    const stmt = this._db.prepare('SELECT pageName, contentPreview FROM block_metadata WHERE uuid = ?');
    try {
      stmt.bind([uuid]);
      if (stmt.step()) {
        const row = stmt.get();
        return { pageName: row[0] as string, contentPreview: row[1] as string };
      }
      return null;
    } finally {
      stmt.free();
    }
  }

  /** Export the SQLite database as a file download (vectors.sqlite) */
  exportToFile(): void {
    if (!this._db) throw new Error('SQLite database not initialized');
    const data = this._db.export();
    const blob = new Blob([data.buffer as ArrayBuffer], { type: 'application/x-sqlite3' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'vectors.sqlite';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  /** Import a SQLite database from an ArrayBuffer, replacing existing data */
  async importFromFile(buffer: ArrayBuffer): Promise<void> {
    if (!this._SQL) {
      const basePath = (logseq.baseInfo as any).path ?? '';
      const wasmUrl = this.resolveWasmUrl(basePath);
      this._SQL = await initSqlJs({
        locateFile: () => wasmUrl,
      });
    }

    const newDb = new this._SQL.Database(new Uint8Array(buffer));

    // Basic structural validation check (ensure the schema tables exist)
    try {
      const tablesResult = newDb.exec("SELECT name FROM sqlite_master WHERE type='table'");
      const tables = tablesResult.length > 0 ? tablesResult[0].values.map((v: any) => v[0] as string) : [];
      if (!tables.includes('documents') || !tables.includes('kv_store')) {
        throw new Error('Missing required tables: documents and kv_store');
      }

      // Ensure all tables exist (self-healing migration)
      newDb.run(
        'CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT)'
      );
      newDb.run(
        `CREATE TABLE IF NOT EXISTS documents (
          id TEXT PRIMARY KEY,
          content TEXT NOT NULL,
          lastUpdated INTEGER NOT NULL,
          embedding BLOB NOT NULL,
          root_depth INTEGER NOT NULL DEFAULT 0,
          has_heading INTEGER NOT NULL DEFAULT 0
        )`
      );
      newDb.run(
        `CREATE TABLE IF NOT EXISTS block_metadata (
          uuid TEXT PRIMARY KEY,
          pageName TEXT NOT NULL,
          contentPreview TEXT NOT NULL
        )`
      );
    } catch (err: any) {
      newDb.close();
      throw new Error(`Invalid SQLite database format or schema structure: ${err.message}`);
    }

    if (this._db) {
      this._db.close();
    }

    this._db = newDb;
    await this.flushWithRetry();
  }

  /** Get the size of the SQLite database in bytes */
  async getDatabaseSize(): Promise<number> {
    if (!this._db) return 0;
    const data = this._db.export();
    return data.byteLength;
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
    await this.idbSave(data.buffer as ArrayBuffer);
  }

  /** Resolve the WASM binary URL for sql.js */
  private resolveWasmUrl(basePath: string): string {
    if (basePath) {
      return `file://${basePath.replaceAll('\\', '/')}/dist/sql-wasm.wasm`;
    }
    return 'sql-wasm.wasm';
  }

  // --- IndexedDB helpers ---

  private openIDB(dbName: string = SQLiteVectorStore.DB_NAME): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
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
    // First try the new DB_NAME
    let data = await this.idbLoadFromDb(SQLiteVectorStore.DB_NAME);
    if (!data) {
      // Fallback to legacy DB_NAME
      data = await this.idbLoadFromDb('logseq-composer-vectors');
      if (data) {
        console.info('[SQLiteVectorStore] Found legacy database in logseq-composer-vectors. Will migrate to logseq-mixer-vectors on next save.');
      }
    }
    return data;
  }

  private async idbLoadFromDb(dbName: string): Promise<ArrayBuffer | null> {
    try {
      const db = await this.openIDB(dbName);
      return new Promise((resolve, reject) => {
        const tx = db.transaction(SQLiteVectorStore.STORE_NAME, 'readonly');
        const store = tx.objectStore(SQLiteVectorStore.STORE_NAME);
        const request = store.get(this.idbKey);
        request.onsuccess = () => { db.close(); resolve(request.result ?? null); };
        request.onerror = () => { db.close(); reject(request.error); };
      });
    } catch (err) {
      console.warn(`[SQLiteVectorStore] Failed to load from IndexedDB database: ${dbName}`, err);
      return null;
    }
  }
}
