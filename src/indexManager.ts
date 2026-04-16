// File: IndexManager.ts

import { getByID, remove } from "@orama/orama";
import { DEFAULT_EMBEDDING_MODEL, extractOutgoingLinks, fetchBacklinks, getEmbeddingsForPage, PageLinkData } from "embedManager";
import { batchInsertEmbeddings, OramaInstance } from "VectorDBManager";
import type { DocumentRecord, PerDocumentStorageProvider, StorageProvider } from "./storage/StorageProvider";

const BATCH_SIZE = 5;

let hasHooked = false;
let currentApiKey = '';
let currentEmbeddingKey = '';
let currentModel = '';
let currentOramaInstance: OramaInstance | undefined;
let currentStorageProvider: StorageProvider;
let indexingInProgress = false;
let _pauseRequested = false;

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
  return name.startsWith('card') ||
         name.startsWith('contents') ||
         name.startsWith('favorites') ||
         name.startsWith('__') ||
         name === 'journals' ||
         name === 'contents' ||
         name === 'favorites';
};

export async function checkAndIndexUpdatedPages(
  apiKey: string,
  oramaInstance: OramaInstance | undefined,
  embeddingApiKey: string,
  model: string = DEFAULT_EMBEDDING_MODEL,
  storageProvider: StorageProvider
): Promise<void> {
  if (indexingInProgress) return;

  indexingInProgress = true;
  _pauseRequested = false;

  try {
    const pages = (await logseq.Editor.getAllPages()) ?? [];

    const isPerDoc = isPerDocumentProvider(storageProvider);
    const supportsBulk = isPerDoc && typeof storageProvider.beginBulk === 'function';
    if (supportsBulk) {
      storageProvider.beginBulk!();
    }

    let pagesInBatch = 0;

    for (const page of pages) {
      // Check for pause request between pages
      if (_pauseRequested) {
        console.info('[indexManager] Indexing paused by user.');
        if (supportsBulk) {
          storageProvider.endBulk!();
          await storageProvider.persistToIndexedDB!();
        }
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

          const newEmbeddings = await getEmbeddingsForPage(
            pageIdStr,
            blocks,
            page.name,
            lastUpdated,
            embeddingApiKey,
            model,
            page.properties,
            linkData
          );

          // Delete old chunks for this page
          const oldChunkIds = [pageIdStr];
          for (let c = 0; c < 100; c++) {
            oldChunkIds.push(`${page.id}_chunk_${c}`);
          }
          await storageProvider.deleteDocuments(oldChunkIds);

          // Map embeddings to DocumentRecord[] and upsert
          const docs: DocumentRecord[] = newEmbeddings.map(e => ({
            id: e.id,
            content: e.content,
            lastUpdated: e.lastUpdated,
            embedding: e.embedding,
          }));
          await storageProvider.upsertDocuments(docs);

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
      } else {
        // --- Legacy Orama-based path ---
        if (!oramaInstance) {
          console.error('[indexManager] Legacy path requires oramaInstance but none was provided.');
          continue;
        }

        const dbRecord = getByID(oramaInstance, pageIdStr);
        if (dbRecord && dbRecord.lastUpdated >= lastUpdated) continue;

        try {
          const blocks = await logseq.Editor.getPageBlocksTree(page.uuid);

          const blockContentLines = collectBlockContent(blocks);
          const outgoingLinks = extractOutgoingLinks(blockContentLines);
          const backlinks = await fetchBacklinks(page.name);
          const linkData: PageLinkData = { outgoingLinks, backlinks };

          const newEmbeddings = await getEmbeddingsForPage(
            pageIdStr,
            blocks,
            page.name,
            lastUpdated,
            embeddingApiKey,
            model,
            page.properties,
            linkData
          );

          // Remove old record and any existing chunks for this page
          if (dbRecord?.id) {
            await remove(oramaInstance, dbRecord.id);
          }
          for (let c = 0; c < 100; c++) {
            const chunkId = `${page.id}_chunk_${c}`;
            const chunkRecord = getByID(oramaInstance, chunkId);
            if (!chunkRecord) break;
            await remove(oramaInstance, chunkId);
          }

          await batchInsertEmbeddings(oramaInstance, newEmbeddings, storageProvider);
        } catch (error) {
          console.error(`Error indexing page ${page.name} (ID: ${page.uuid}):`, error);
        }
      }
    }

    // Ensure final batch is persisted after loop completes
    if (supportsBulk) {
      storageProvider.endBulk!();
      await storageProvider.persistToIndexedDB!();
    }
  } finally {
    setTimeout(() => {
      indexingInProgress = false;
    }, 1000); // 1 second cooldown
  }
}

export function startPageIndexingOnChange(
  apiKey: string,
  oramaInstance: OramaInstance | undefined,
  embeddingApiKey: string,
  model: string = DEFAULT_EMBEDDING_MODEL,
  storageProvider: StorageProvider
): void {
  currentApiKey = apiKey;
  currentEmbeddingKey = embeddingApiKey;
  currentModel = model;
  currentOramaInstance = oramaInstance;
  currentStorageProvider = storageProvider;

  if (hasHooked) return;
  hasHooked = true;

  logseq.DB.onChanged(async () => {
    if (getIsUpdatingSettings()) return;
    try {
      await checkAndIndexUpdatedPages(currentApiKey, currentOramaInstance, currentEmbeddingKey, currentModel, currentStorageProvider);
    } catch (err) {
      console.error('Error indexing updated pages:', err);
    }
  });
}
