import type { SQLiteVectorStore } from './storage/SQLiteVectorStore';
import type { BM25Index } from './bm25Index';

export interface MigrationState {
  status: 'pending' | 'in-progress' | 'completed';
  lastMigratedPageId: string | null;
  totalPages: number;
  migratedPages: number;
}

/**
 * Callback type for re-indexing a single page during migration.
 * Provided by the integration layer (indexManager) when wiring up the migration.
 * Should handle: fetching blocks, chunking, embedding, upserting, and BM25 updates.
 */
export type ReindexPageCallback = (pageId: string) => Promise<void>;

/**
 * Manages schema migration and background re-indexing for existing users
 * upgrading from adjacency-based chunking (v1) to hierarchy-aware chunking (v2).
 *
 * Responsibilities:
 * - Detect whether migration is needed (no schema version marker or version !== "2")
 * - Add new columns (root_depth, has_heading) if missing
 * - Schedule non-blocking background re-indexing page-by-page
 * - Resume interrupted migrations from the last checkpoint
 * - Track migration progress
 * - Allow cancellation of in-progress migrations
 */
export class ChunkMigrationManager {
  private readonly storageProvider: SQLiteVectorStore;
  private bm25Index: BM25Index | null = null;
  private readonly state: MigrationState = {
    status: 'pending',
    lastMigratedPageId: null,
    totalPages: 0,
    migratedPages: 0,
  };
  private cancelled = false;
  private migrationTimer: ReturnType<typeof setTimeout> | null = null;
  private reindexPageCallback: ReindexPageCallback | null = null;

  constructor(storageProvider: SQLiteVectorStore, bm25Index?: BM25Index) {
    this.storageProvider = storageProvider;
    this.bm25Index = bm25Index ?? null;
  }

  /**
   * Check if migration is needed.
   * Migration is needed when the chunking_version is not "2".
   * Requirement 7.1: detect old format by absence of schema version marker.
   */
  needsMigration(): boolean {
    const version = this.storageProvider.getChunkingVersion();
    return version !== '2';
  }

  /**
   * Add root_depth and has_heading columns if missing.
   * Uses ALTER TABLE with try/catch since columns may already exist.
   * Requirement 8.2: add column with default value of 0.
   */
  ensureSchemaColumns(): void {
    const db = this.storageProvider.db;
    if (!db) return;

    try {
      db.run('ALTER TABLE documents ADD COLUMN root_depth INTEGER NOT NULL DEFAULT 0');
    } catch {
      // Column already exists — safe to ignore
    }

    try {
      db.run('ALTER TABLE documents ADD COLUMN has_heading INTEGER NOT NULL DEFAULT 0');
    } catch {
      // Column already exists — safe to ignore
    }
  }

  /**
   * Set the callback used to re-index a single page.
   * This is provided by the integration layer since the migration manager
   * doesn't have direct access to embedding APIs or the chunker.
   */
  setReindexCallback(callback: ReindexPageCallback): void {
    this.reindexPageCallback = callback;
  }

  /**
   * Set the BM25 index reference for removing old entries during migration.
   */
  setBm25Index(bm25Index: BM25Index): void {
    this.bm25Index = bm25Index;
  }

  /**
   * Schedule background re-indexing. Returns immediately (non-blocking).
   * Processes pages one at a time in the background using setTimeout.
   *
   * Requirements 7.2, 7.3: serve existing results while re-indexing page-by-page.
   * Requirement 10.2: remove old BM25 entries before inserting new ones.
   */
  scheduleBackgroundReindex(
    apiKey: string,
    model: string,
    endpoint?: string,
    provider?: 'openai' | 'ollama'
  ): void {
    if (this.state.status === 'in-progress') return;

    this.cancelled = false;
    this.state.status = 'in-progress';

    // Non-blocking: schedule the actual work via setTimeout so this returns immediately
    this.migrationTimer = setTimeout(() => {
      void this.runMigration();
    }, 0);
  }

  /**
   * Resume interrupted migration from last checkpoint.
   * Reads migration_cursor from kv_store and resumes from last un-migrated page.
   * Requirement 7.5: resume from last un-migrated page on plugin load.
   */
  resumeIfNeeded(): void {
    if (!this.needsMigration()) {
      this.state.status = 'completed';
      return;
    }

    const cursor = this.getMigrationCursor();
    if (cursor !== null) {
      this.state.lastMigratedPageId = cursor;
      this.state.status = 'in-progress';

      // Schedule continuation
      this.cancelled = false;
      this.migrationTimer = setTimeout(() => {
        void this.runMigration();
      }, 0);
    }
  }

  /**
   * Get current migration progress.
   */
  getState(): MigrationState {
    return { ...this.state };
  }

  /**
   * Cancel an in-progress migration.
   */
  cancel(): void {
    this.cancelled = true;
    if (this.migrationTimer !== null) {
      clearTimeout(this.migrationTimer);
      this.migrationTimer = null;
    }
    if (this.state.status === 'in-progress') {
      this.state.status = 'pending';
    }
  }

  // --- Private helpers ---

  /**
   * Core migration loop. Processes pages one at a time with yields between each
   * to keep the UI responsive.
   */
  private async runMigration(): Promise<void> {
    const allPageIds = this.getAllPageIds();
    this.state.totalPages = allPageIds.length;

    // Find the starting index based on the cursor
    let startIndex = 0;
    if (this.state.lastMigratedPageId !== null) {
      const cursorIdx = allPageIds.indexOf(this.state.lastMigratedPageId);
      if (cursorIdx >= 0) {
        startIndex = cursorIdx + 1;
        this.state.migratedPages = startIndex;
      }
    }

    for (let i = startIndex; i < allPageIds.length; i++) {
      if (this.cancelled) {
        return;
      }

      const pageId = allPageIds[i];

      try {
        // Remove old BM25 entries for this page before re-indexing (Req 10.2)
        this.removeOldBm25Entries(pageId);

        // Re-index the page using the provided callback
        if (this.reindexPageCallback) {
          await this.reindexPageCallback(pageId);
        }

        // Update cursor checkpoint
        this.state.lastMigratedPageId = pageId;
        this.state.migratedPages = i + 1;
        this.setMigrationCursor(pageId);
      } catch (err) {
        // Log error, skip page, continue with next page (error handling from design)
        console.error(`[ChunkMigrationManager] Error migrating page "${pageId}":`, err);
      }

      // Yield to event loop between pages to keep UI responsive
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    // Migration complete — update schema version marker (Req 7.4)
    if (!this.cancelled) {
      this.storageProvider.setChunkingVersion('2');
      this.clearMigrationCursor();
      this.state.status = 'completed';
    }
  }

  /**
   * Get all distinct page IDs from the documents table.
   * Strips _chunk_N suffixes to get unique base page IDs.
   */
  private getAllPageIds(): string[] {
    const db = this.storageProvider.db;
    if (!db) return [];

    const result = db.exec(
      "SELECT DISTINCT CASE WHEN INSTR(id, '_chunk_') > 0 THEN SUBSTR(id, 1, INSTR(id, '_chunk_') - 1) ELSE id END AS page_id FROM documents ORDER BY page_id"
    );

    if (result.length === 0 || result[0].values.length === 0) {
      return [];
    }

    return result[0].values.map(row => row[0] as string);
  }

  /**
   * Remove old BM25 entries for a page (all chunks: pageId, pageId_chunk_0, etc.)
   * Requirement 10.2: remove old chunk entries from BM25 before inserting new ones.
   */
  private removeOldBm25Entries(pageId: string): void {
    if (!this.bm25Index) return;

    const idsToRemove = [pageId];
    // Remove potential chunk IDs (up to 100 chunks per page)
    for (let c = 0; c < 100; c++) {
      idsToRemove.push(`${pageId}_chunk_${c}`);
    }
    this.bm25Index.removeDocuments(idsToRemove);
  }

  /**
   * Read the migration_cursor from kv_store.
   */
  private getMigrationCursor(): string | null {
    const db = this.storageProvider.db;
    if (!db) return null;

    const result = db.exec(
      "SELECT value FROM kv_store WHERE key = 'migration_cursor'"
    );
    if (result.length > 0 && result[0].values.length > 0) {
      return result[0].values[0][0] as string;
    }
    return null;
  }

  /**
   * Write the migration_cursor to kv_store.
   */
  private setMigrationCursor(pageId: string): void {
    const db = this.storageProvider.db;
    if (!db) return;

    db.run(
      "INSERT OR REPLACE INTO kv_store (key, value) VALUES ('migration_cursor', ?)",
      [pageId]
    );
  }

  /**
   * Remove the migration_cursor from kv_store after migration completes.
   */
  private clearMigrationCursor(): void {
    const db = this.storageProvider.db;
    if (!db) return;

    db.run("DELETE FROM kv_store WHERE key = 'migration_cursor'");
  }
}
