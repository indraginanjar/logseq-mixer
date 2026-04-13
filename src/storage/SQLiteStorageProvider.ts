import initSqlJs, { type Database } from 'sql.js';
import type { StorageProvider } from './StorageProvider';

/**
 * SQLiteStorageProvider persists the Orama vector database in a sql.js
 * in-memory SQLite database, backed by IndexedDB for persistence.
 *
 * This avoids the need for Node.js `fs`/`path` which aren't available
 * in the Logseq plugin sandbox.
 */
export class SQLiteStorageProvider implements StorageProvider {
  private db: Database | null = null;
  private idbKey: string;
  private static readonly DB_NAME = 'logseq-composer-vectors';
  private static readonly STORE_NAME = 'sqlite';

  constructor(graphPath: string) {
    // Use the graph path to create a unique IndexedDB key per graph
    this.idbKey = `vectors:${graphPath}`;
  }

  async initialize(): Promise<void> {
    // Resolve the WASM binary URL relative to the plugin's base path
    const basePath = (logseq.baseInfo as any).path ?? '';
    const wasmUrl = this.resolveWasmUrl(basePath);
    console.info(`[SQLiteStorageProvider] Loading WASM from: ${wasmUrl}`);

    const SQL = await initSqlJs({
      locateFile: () => wasmUrl,
    });

    // Try to restore from IndexedDB
    const existingData = await this.idbLoad();
    if (existingData) {
      console.info('[SQLiteStorageProvider] Restoring database from IndexedDB.');
      this.db = new SQL.Database(new Uint8Array(existingData));
    } else {
      console.info('[SQLiteStorageProvider] Creating new database.');
      this.db = new SQL.Database();
    }

    this.db.run(
      'CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT)'
    );
  }

  async save(data: string): Promise<void> {
    if (!this.db) throw new Error('SQLite database not initialized');
    this.db.run(
      'INSERT OR REPLACE INTO kv_store (key, value) VALUES (?, ?)',
      ['orama_db', data]
    );
    await this.flush();
  }

  async load(): Promise<string | null> {
    if (!this.db) throw new Error('SQLite database not initialized');
    const result = this.db.exec(
      "SELECT value FROM kv_store WHERE key = 'orama_db'"
    );
    if (result.length === 0 || result[0].values.length === 0) {
      return null;
    }
    return result[0].values[0][0] as string;
  }

  async clear(): Promise<void> {
    if (!this.db) throw new Error('SQLite database not initialized');
    this.db.run("DELETE FROM kv_store WHERE key = 'orama_db'");
    await this.flush();
  }

  /** Export the SQLite database as a file download (vectors.sqlite) */
  exportToFile(): void {
    if (!this.db) throw new Error('SQLite database not initialized');
    const data = this.db.export();
    const blob = new Blob([data], { type: 'application/x-sqlite3' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'vectors.sqlite';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /** Persist the in-memory database to IndexedDB */
  private async flush(): Promise<void> {
    if (!this.db) return;
    const data = this.db.export();
    await this.idbSave(data.buffer);
  }

  /** Resolve the WASM binary URL for sql.js */
  private resolveWasmUrl(basePath: string): string {
    // In Logseq plugin environment, assets are served relative to the plugin path
    // Try the dist subfolder first (standard build output), then the base path
    if (basePath) {
      return `file://${basePath.replace(/\\/g, '/')}/dist/sql-wasm.wasm`;
    }
    // Fallback: assume WASM is co-located with the plugin entry
    return 'sql-wasm.wasm';
  }

  // --- IndexedDB helpers ---

  private openIDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(SQLiteStorageProvider.DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(SQLiteStorageProvider.STORE_NAME)) {
          db.createObjectStore(SQLiteStorageProvider.STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  private async idbSave(buffer: ArrayBuffer): Promise<void> {
    const db = await this.openIDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SQLiteStorageProvider.STORE_NAME, 'readwrite');
      const store = tx.objectStore(SQLiteStorageProvider.STORE_NAME);
      store.put(buffer, this.idbKey);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }

  private async idbLoad(): Promise<ArrayBuffer | null> {
    const db = await this.openIDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SQLiteStorageProvider.STORE_NAME, 'readonly');
      const store = tx.objectStore(SQLiteStorageProvider.STORE_NAME);
      const request = store.get(this.idbKey);
      request.onsuccess = () => { db.close(); resolve(request.result ?? null); };
      request.onerror = () => { db.close(); reject(request.error); };
    });
  }
}
