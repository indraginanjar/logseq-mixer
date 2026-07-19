// File: IndexManager.ts

export type IndexingOutcome = 'completed' | 'paused' | 'error';

export interface IndexingResult {
  outcome: IndexingOutcome;
  pagesProcessed: number;
  errorMessage?: string;
}

import { DEFAULT_EMBEDDING_MODEL, EmbeddingProvider, extractOutgoingLinks, fetchBacklinks, getEmbeddingsForPage, PageLinkData } from "embedManager";
import { shouldSuppressAutoIndex } from "./cooldownManager";
import { ChunkMigrationManager } from "./chunkMigrationManager";
import type { BM25Index } from "./bm25Index";
import type { DocumentRecord, PerDocumentStorageProvider, StorageProvider } from "./storage/StorageProvider";
import type { DocumentRecordWithDepth } from "./storage/SQLiteVectorStore";
import type { VectorSearchAccelerator } from "./storage/VectorSearchAccelerator";

const BATCH_SIZE = 5;

let hasHooked = false;
let currentApiKey = '';
let currentEmbeddingKey = '';
let currentModel = '';
let currentEmbeddingEndpoint = '';
let currentEmbeddingProvider: EmbeddingProvider = 'openai';
let currentOramaInstance: any;
let currentStorageProvider: StorageProvider;
let currentAccelerator: VectorSearchAccelerator | undefined;
let indexingInProgress = false;
let _pauseRequested = false;
let _pagesProcessed = 0;

/** Module-level migration manager instance, created during initialization. */
let migrationManager: ChunkMigrationManager | null = null;

/** Module-level BM25 index reference for updating during indexing. */
let _bm25Index: BM25Index | null = null;

/**
 * Set the BM25 index reference so that indexing operations can update BM25 entries.
 * Called by the manager layer after ensuring the BM25 index exists.
 */
export function setIndexManagerBM25(bm25Index: BM25Index | null): void {
  _bm25Index = bm25Index;
}

/**
 * Initialize the chunk migration manager for the given storage provider.
 * - Ensures schema columns (root_depth, has_heading) exist
 * - Resumes interrupted migrations if needed
 * - Sets the re-index callback for background migration
 *
 * Should be called once during plugin initialization, after the storage provider
 * is ready and before indexing starts.
 */
export function initializeMigrationManager(
  storageProvider: PerDocumentStorageProvider,
  bm25Index?: BM25Index | null,
  reindexCallback?: (pageId: string) => Promise<void>
): ChunkMigrationManager {
  const { SQLiteVectorStore } = require('./storage/SQLiteVectorStore');
  if (!(storageProvider instanceof SQLiteVectorStore)) {
    throw new TypeError('[initializeMigrationManager] Requires SQLiteVectorStore');
  }

  const manager = new ChunkMigrationManager(storageProvider as any, bm25Index ?? undefined);

  // Ensure schema columns exist (Req 8.2: add columns with default 0)
  manager.ensureSchemaColumns();

  // Set reindex callback if provided
  if (reindexCallback) {
    manager.setReindexCallback(reindexCallback);
  }

  // Resume interrupted migration if needed (Req 7.5)
  manager.resumeIfNeeded();

  migrationManager = manager;
  return manager;
}

/**
 * Get the current migration manager instance (may be null if not yet initialized).
 */
export function getMigrationManager(): ChunkMigrationManager | null {
  return migrationManager;
}

/**
 * Request the current indexing run to pause after the current page finishes.
 * Returns immediately — the loop will stop at the next iteration.
 */
export function requestPauseIndexing(): void {
  _pauseRequested = true;
}

/**
 * Returns true while an indexing run is active.
 */
export function isIndexingActive(): boolean {
  return indexingInProgress;
}

/**
 * Returns the number of pages processed so far in the current (or most recent) indexing run.
 */
export function getIndexingProgress(): number {
  return _pagesProcessed;
}

/**
 * Reset module-level indexing state. Intended for tests only — ensures clean
 * state between fast-check iterations when the 1-second cooldown timer may
 * not have fired due to fake timers or test parallelism.
 * @internal
 */
export function _resetIndexingState(): void {
  indexingInProgress = false;
  _pauseRequested = false;
  _pagesProcessed = 0;
  migrationManager = null;
  _bm25Index = null;
}

let _isUpdatingSettings = false;

export function getIsUpdatingSettings(): boolean {
  return _isUpdatingSettings;
}

export function setIsUpdatingSettings(value: boolean): void {
  _isUpdatingSettings = value;
}

/**
 * Type guard: returns true when the storage provider supports per-document
 * operations (SQLiteVectorStore), false for the legacy Orama-based path.
 */
function isPerDocumentProvider(provider: any): provider is PerDocumentStorageProvider {
  return typeof provider?.getDocumentMeta === 'function';
}

/**
 * Type guard: returns true when the storage provider supports depth-aware upserts.
 */
function hasDepthUpsert(provider: any): provider is PerDocumentStorageProvider & { upsertDocumentsWithDepth(docs: DocumentRecordWithDepth[]): Promise<void> } {
  return typeof provider?.upsertDocumentsWithDepth === 'function';
}

/**
 * Recursively collect all block content strings from a block tree.
 * Used to extract outgoing links before the full embedding pipeline runs.
 */
function collectBlockContent(blocks: any[]): string[] {
  const lines: string[] = [];
  for (const block of blocks) {
    if (block.content) {
      lines.push(block.content);
    }
    if (block.children && block.children.length > 0) {
      lines.push(...collectBlockContent(block.children));
    }
  }
  return lines;
}

const isInternalPage = (name: string) => {
  const lower = name.toLowerCase();
  return lower.startsWith('card') ||
         lower.startsWith('contents') ||
         lower.startsWith('favorites') ||
         lower.startsWith('__') ||
         lower.startsWith('mixer/') ||
         lower === 'journals' ||
         lower === 'contents' ||
         lower === 'favorites';
};

/**
 * Garbage collection: detect indexed pages that no longer exist in the graph
 * and purge their chunks, block metadata, BM25 entries, and accelerator vectors.
 *
 * Runs synchronously on in-memory SQLite — no async I/O needed.
 * Called at the beginning of each incremental indexing run.
 */
export function purgeDeletedPages(
  existingPages: Array<{ id: number | string; name: string }>,
  storageProvider: PerDocumentStorageProvider,
  accelerator?: VectorSearchAccelerator
): number {
  // Build set of page IDs that currently exist in the graph
  const existingPageIds = new Set(existingPages.map(p => p.id.toString()));

  // Get all page IDs present in the index
  const getIndexedPageIds = (storageProvider as any).getIndexedPageIds;
  if (typeof getIndexedPageIds !== 'function') return 0;

  const indexedPageIds: Set<string> = getIndexedPageIds.call(storageProvider);

  // Find stale page IDs (indexed but no longer in graph)
  const stalePageIds: string[] = [];
  for (const indexedId of indexedPageIds) {
    if (!existingPageIds.has(indexedId)) {
      stalePageIds.push(indexedId);
    }
  }

  if (stalePageIds.length === 0) return 0;

  console.info(`[indexManager] GC: purging ${stalePageIds.length} deleted page(s) from index.`);

  // Collect page names (for block_metadata cleanup) and chunk IDs (for document deletion)
  const getDocumentIdsForPage = (storageProvider as any).getDocumentIdsForPage;
  const getPageNameForPageId = (storageProvider as any).getPageNameForPageId;

  const allChunkIds: string[] = [];
  const pageNames: string[] = [];

  for (const pageId of stalePageIds) {
    // Get chunk IDs for this page
    if (typeof getDocumentIdsForPage === 'function') {
      const chunkIds: string[] = getDocumentIdsForPage.call(storageProvider, pageId);
      allChunkIds.push(...chunkIds);
    } else {
      // Fallback: construct expected IDs
      allChunkIds.push(pageId);
      for (let c = 0; c < 100; c++) {
        allChunkIds.push(`${pageId}_chunk_${c}`);
      }
    }

    // Extract page name from stored content for block_metadata cleanup
    if (typeof getPageNameForPageId === 'function') {
      const name = getPageNameForPageId.call(storageProvider, pageId);
      if (name) pageNames.push(name);
    }
  }

  // Delete document chunks
  if (allChunkIds.length > 0) {
    // deleteDocuments is async in signature but synchronous for in-memory SQLite
    storageProvider.deleteDocuments(allChunkIds);

    // Remove from HNSW accelerator
    accelerator?.removeVectors(allChunkIds);

    // Remove from BM25 index
    if (_bm25Index) {
      _bm25Index.removeDocuments(allChunkIds);
    }
  }

  // Delete block metadata for purged pages
  if (pageNames.length > 0) {
    const deleteBlockMetadataForPages = (storageProvider as any).deleteBlockMetadataForPages;
    if (typeof deleteBlockMetadataForPages === 'function') {
      deleteBlockMetadataForPages.call(storageProvider, pageNames);
    } else {
      // Fallback: delete one at a time
      for (const name of pageNames) {
        storageProvider.deleteBlockMetadataForPage?.(name);
      }
    }
  }

  console.info(`[indexManager] GC: removed ${allChunkIds.length} chunk(s) and metadata for ${pageNames.length} page(s).`);
  return stalePageIds.length;
}

export async function checkAndIndexUpdatedPages(
  apiKey: string,
  oramaInstance: any,
  embeddingApiKey: string,
  model: string = DEFAULT_EMBEDDING_MODEL,
  storageProvider: StorageProvider,
  embeddingEndpoint?: string,
  embeddingProvider?: EmbeddingProvider,
  accelerator?: VectorSearchAccelerator
): Promise<IndexingResult> {
  if (indexingInProgress) return { outcome: 'completed', pagesProcessed: 0 };

  indexingInProgress = true;
  _pauseRequested = false;
  _pagesProcessed = 0;

  let result: IndexingResult;

  try {
    const pages = (await logseq.Editor.getAllPages()) ?? [];

    const isPerDoc = isPerDocumentProvider(storageProvider);
    const supportsBulk = isPerDoc && typeof storageProvider.beginBulk === 'function';
    if (supportsBulk) {
      storageProvider.beginBulk!();
    }

    // --- Garbage Collection: purge stale entries from deleted pages ---
    if (isPerDoc) {
      purgeDeletedPages(pages, storageProvider, accelerator);
    }

    let pagesInBatch = 0;
    let pausedByUser = false;

    for (const page of pages) {
      // Check for pause request between pages
      if (_pauseRequested) {
        console.info('[indexManager] Indexing paused by user.');
        if (supportsBulk) {
          storageProvider.endBulk!();
          await storageProvider.persistToIndexedDB!();
        }
        pausedByUser = true;
        break;
      }

      if (isInternalPage(page.name)) continue;

      const pageIdStr = page.id.toString();
      const lastUpdated: number = page.updatedAt ?? 0;

      if (isPerDoc) {
        // --- Per-document path (SQLiteVectorStore) ---
        const storedLastUpdated = await storageProvider.getDocumentMeta(pageIdStr);
        if (storedLastUpdated !== null && storedLastUpdated >= lastUpdated) continue;

        try {
          const blocks = await logseq.Editor.getPageBlocksTree(page.uuid);

          const blockContentLines = collectBlockContent(blocks);
          const outgoingLinks = extractOutgoingLinks(blockContentLines);
          const backlinks = await fetchBacklinks(page.name);
          const linkData: PageLinkData = { outgoingLinks, backlinks };

          // Delete old block metadata for this page before re-indexing
          storageProvider.deleteBlockMetadataForPage?.(page.name);

          const { embeddings: newEmbeddings, blockMetadata, chunkDepthMetadata } = await getEmbeddingsForPage(
            pageIdStr,
            blocks,
            page.name,
            lastUpdated,
            embeddingApiKey,
            model,
            page.properties,
            linkData,
            embeddingEndpoint,
            embeddingProvider
          );

          // Delete old chunks for this page
          const oldChunkIds = [pageIdStr];
          for (let c = 0; c < 100; c++) {
            oldChunkIds.push(`${page.id}_chunk_${c}`);
          }
          await storageProvider.deleteDocuments(oldChunkIds);
          accelerator?.removeVectors(oldChunkIds);

          // Remove old BM25 entries for this page before inserting new ones (Req 10.2)
          if (_bm25Index) {
            _bm25Index.removeDocuments(oldChunkIds);
          }

          // Map embeddings to DocumentRecordWithDepth[] and upsert with depth metadata (Req 8.1, 8.3)
          if (hasDepthUpsert(storageProvider) && chunkDepthMetadata) {
            const docsWithDepth: DocumentRecordWithDepth[] = newEmbeddings.map((e, idx) => ({
              id: e.id,
              content: e.content,
              lastUpdated: e.lastUpdated,
              embedding: e.embedding,
              rootDepth: chunkDepthMetadata[idx]?.rootDepth ?? 0,
              hasHeading: chunkDepthMetadata[idx]?.hasHeading ?? false,
            }));
            await storageProvider.upsertDocumentsWithDepth(docsWithDepth);
          } else {
            const docs: DocumentRecord[] = newEmbeddings.map(e => ({
              id: e.id,
              content: e.content,
              lastUpdated: e.lastUpdated,
              embedding: e.embedding,
            }));
            await storageProvider.upsertDocuments(docs);
          }
          accelerator?.addVectors(newEmbeddings.map(d => ({ id: d.id, content: d.content, embedding: d.embedding })));

          // Register new chunk content in BM25 index (Req 10.1)
          if (_bm25Index) {
            _bm25Index.upsertDocuments(newEmbeddings.map(e => ({ id: e.id, content: e.content })));
          }

          // Upsert block metadata after successful indexing
          if (blockMetadata.length > 0) {
            storageProvider.upsertBlockMetadata?.(blockMetadata);
          }
          _pagesProcessed++;

          pagesInBatch++;
          if (pagesInBatch >= BATCH_SIZE) {
            if (supportsBulk) {
              await storageProvider.persistToIndexedDB!();
            }
            await new Promise(resolve => setTimeout(resolve, 0));
            pagesInBatch = 0;
          }
        } catch (error) {
          console.error(`Error indexing page ${page.name} (ID: ${page.uuid}):`, error);
        }
      }
    }

    // Ensure final batch is persisted after loop completes
    if (!pausedByUser && supportsBulk) {
      storageProvider.endBulk!();
      await storageProvider.persistToIndexedDB!();
    }

    result = pausedByUser
      ? { outcome: 'paused', pagesProcessed: _pagesProcessed }
      : { outcome: 'completed', pagesProcessed: _pagesProcessed };
  } catch (error: any) {
    result = {
      outcome: 'error',
      pagesProcessed: _pagesProcessed,
      errorMessage: error?.message ?? String(error),
    };
  } finally {
    setTimeout(() => {
      indexingInProgress = false;
    }, 1000); // 1 second cooldown
  }

  return result;
}

/** Default debounce delay for auto-indexing on DB changes (ms). */
const DEFAULT_AUTO_INDEX_DEBOUNCE_MS = 300_000; // 5 minutes

/** Current debounce delay, configurable via plugin settings. */
let _autoIndexDebounceMs = DEFAULT_AUTO_INDEX_DEBOUNCE_MS;

/** Update the auto-index debounce delay (in seconds, from settings). */
export function setAutoIndexDebounceSeconds(seconds: number): void {
  _autoIndexDebounceMs = Math.max(10, seconds) * 1000; // minimum 10 seconds
}

/** Module-level debounce timer for the auto-indexer's onChanged callback. */
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/** Tracks whether the auto-embed toggle is enabled. */
let _autoEmbedEnabled = true;

/** Update the auto-embed enabled state used by the onChanged suppression guard. */
export function setAutoEmbedEnabled(enabled: boolean): void {
  _autoEmbedEnabled = enabled;
}

/** Cancel any pending auto-index debounce timer. */
export function cancelAutoIndexDebounce(): void {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

export function startPageIndexingOnChange(
  apiKey: string,
  oramaInstance: any,
  embeddingApiKey: string,
  model: string = DEFAULT_EMBEDDING_MODEL,
  storageProvider: StorageProvider,
  embeddingEndpoint?: string,
  embeddingProvider?: EmbeddingProvider,
  accelerator?: VectorSearchAccelerator
): void {
  currentApiKey = apiKey;
  currentEmbeddingKey = embeddingApiKey;
  currentModel = model;
  currentOramaInstance = oramaInstance;
  currentStorageProvider = storageProvider;
  currentEmbeddingEndpoint = embeddingEndpoint ?? '';
  currentEmbeddingProvider = embeddingProvider ?? 'openai';
  currentAccelerator = accelerator;

  if (hasHooked) return;
  hasHooked = true;

  logseq.DB.onChanged(() => {
    if (getIsUpdatingSettings()) return;
    if (shouldSuppressAutoIndex(_autoEmbedEnabled)) return;

    // Clear any pending debounce timer and restart the wait
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(async () => {
      debounceTimer = null;
      try {
        await checkAndIndexUpdatedPages(currentApiKey, currentOramaInstance, currentEmbeddingKey, currentModel, currentStorageProvider, currentEmbeddingEndpoint, currentEmbeddingProvider, currentAccelerator);
      } catch (err) {
        console.error('Error indexing updated pages:', err);
      }
    }, _autoIndexDebounceMs);
  });
}
