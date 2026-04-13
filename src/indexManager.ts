// File: IndexManager.ts

import { getByID, remove } from "@orama/orama";
import { DEFAULT_EMBEDDING_MODEL, extractOutgoingLinks, fetchBacklinks, getEmbeddingsForPage, PageLinkData } from "embedManager";
import { batchInsertEmbeddings, OramaInstance } from "VectorDBManager";
import type { StorageProvider } from "./storage/StorageProvider";

let hasHooked = false;
let currentApiKey = '';
let currentEmbeddingKey = '';
let currentModel = '';
let currentOramaInstance: OramaInstance;
let currentStorageProvider: StorageProvider;
let indexingInProgress = false;

let _isUpdatingSettings = false;

export function getIsUpdatingSettings(): boolean {
  return _isUpdatingSettings;
}

export function setIsUpdatingSettings(value: boolean): void {
  _isUpdatingSettings = value;
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
  oramaInstance: OramaInstance,
  embeddingApiKey: string,
  model: string = DEFAULT_EMBEDDING_MODEL,
  storageProvider: StorageProvider
): Promise<void> {
  if (indexingInProgress) return;

  indexingInProgress = true;

  try {
    const pages = (await logseq.Editor.getAllPages()) ?? [];

    for (const page of pages) {
      if (isInternalPage(page.name)) continue;

      const dbRecord = getByID(oramaInstance, page.id.toString());
      const lastUpdated: number = page.updatedAt ?? 0;

      if (dbRecord && dbRecord.lastUpdated >= lastUpdated) continue;

      try {
        const blocks = await logseq.Editor.getPageBlocksTree(page.uuid);

        // Extract graph context for the page
        const blockContentLines = collectBlockContent(blocks);
        const outgoingLinks = extractOutgoingLinks(blockContentLines);
        const backlinks = await fetchBacklinks(page.name);
        const linkData: PageLinkData = { outgoingLinks, backlinks };

        const newEmbeddings = await getEmbeddingsForPage(
          page.id.toString(),
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
        // Remove old chunks (try chunk_0 through chunk_99 as a safe upper bound)
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
  } finally {
    setTimeout(() => {
      indexingInProgress = false;
    }, 1000); // 1 second cooldown
  }
}

export function startPageIndexingOnChange(
  apiKey: string,
  oramaInstance: OramaInstance,
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
