
export type VectorDBSchemaDynamic = {
  id: string;
  content: string;
  lastUpdated: number;
  embedding: number[]; // embedding as a number array
};

export interface EmbeddingModelConfig {
  name: string;
  dimensions: number;
  maxTokens: number;
}

export const EMBEDDING_MODELS: Record<string, EmbeddingModelConfig> = {
  'text-embedding-ada-002': { name: 'text-embedding-ada-002', dimensions: 1536, maxTokens: 8191 },
  'text-embedding-3-small': { name: 'text-embedding-3-small', dimensions: 1536, maxTokens: 8191 },
  'text-embedding-3-large': { name: 'text-embedding-3-large', dimensions: 3072, maxTokens: 8191 },
};

export const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';

export function getDimensionsForModel(model: string): number {
  const config = EMBEDDING_MODELS[model];
  if (!config) throw new Error(`Unknown embedding model: ${model}`);
  return config.dimensions;
}

export function isValidEmbeddingModel(model: string): boolean {
  return model in EMBEDDING_MODELS;
}

// text-embedding-ada-002 has an 8191 token limit.
// Max chars per chunk, leaving room for page metadata header.
const MAX_CHUNK_CHARS = 24000;

/**
 * Resolve block references ((uuid)) and block embeds {{embed ((uuid))}}
 * by fetching the referenced block's content from Logseq.
 * Uses a cache to avoid redundant API calls for the same block.
 */
const refCache = new Map<string, string>();

async function resolveBlockReferences(content: string): Promise<string> {
  // Match block embeds: {{embed ((uuid))}}
  const embedRegex = /\{\{embed\s+\(\(([a-f0-9-]+)\)\)\s*\}\}/gi;
  // Match block references: ((uuid))
  const refRegex = /\(\(([a-f0-9-]+)\)\)/g;

  let resolved = content;

  // Resolve embeds first (they contain refs inside)
  const embedMatches = [...content.matchAll(embedRegex)];
  for (const match of embedMatches) {
    const uuid = match[1];
    const refContent = await fetchBlockContent(uuid);
    resolved = resolved.replace(match[0], refContent);
  }

  // Resolve remaining block references
  const refMatches = [...resolved.matchAll(refRegex)];
  for (const match of refMatches) {
    const uuid = match[1];
    const refContent = await fetchBlockContent(uuid);
    resolved = resolved.replace(match[0], refContent);
  }

  return resolved;
}

async function fetchBlockContent(uuid: string): Promise<string> {
  if (refCache.has(uuid)) {
    return refCache.get(uuid)!;
  }
  try {
    const block = await logseq.Editor.getBlock(uuid);
    const content = block?.content ?? `((${uuid}))`;
    refCache.set(uuid, content);
    return content;
  } catch {
    // If fetch fails, keep the original reference syntax
    refCache.set(uuid, `((${uuid}))`);
    return `((${uuid}))`;
  }
}

/**
 * Clear the block reference cache. Call before a full indexing run
 * to ensure fresh data.
 */
export function clearRefCache(): void {
  refCache.clear();
}

/**
 * Recursively flatten a block tree into a list of content strings with indentation.
 * Preserves Logseq's block hierarchy.
 * Resolves block references ((uuid)) and embeds {{embed ((uuid))}} to actual content.
 */
async function flattenBlocks(blocks: any[], depth: number = 0): Promise<string[]> {
  const lines: string[] = [];
  for (const block of blocks) {
    if (block.content) {
      const indent = '  '.repeat(depth);
      const resolvedContent = await resolveBlockReferences(block.content);
      lines.push(`${indent}- ${resolvedContent}`);
    }
    if (block.children && block.children.length > 0) {
      lines.push(...await flattenBlocks(block.children, depth + 1));
    }
  }
  return lines;
}

/**
 * Group block lines into chunks that fit within the embedding model's token limit.
 * Each chunk is a string of concatenated block lines.
 * Blocks are never split mid-line — the boundary is always between blocks.
 * If a single block exceeds the limit, it gets its own chunk (truncated).
 */
export function groupBlocksIntoChunks(blockLines: string[], pageHeader: string): string[] {
  if (blockLines.length === 0) {
    return [pageHeader];
  }

  const chunks: string[] = [];
  let currentChunk = pageHeader;

  for (const line of blockLines) {
    const candidate = currentChunk + line + '\n';
    if (candidate.length > MAX_CHUNK_CHARS && currentChunk !== pageHeader) {
      // Current chunk is full, push it and start a new one
      chunks.push(currentChunk);
      currentChunk = pageHeader + line + '\n';
    } else {
      currentChunk = candidate;
    }
  }

  // Push the last chunk
  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

export async function useGenerateEmbedding(inputText: string, apiKey: string, model: string = DEFAULT_EMBEDDING_MODEL): Promise<number[]> {
  if (!apiKey || !apiKey.trim()) {
    throw new Error('Embedding API key is not configured. Please set your OpenAI API key in the plugin settings.');
  }

  // Safety truncation for any single chunk that still exceeds the limit
  const text = inputText.length > MAX_CHUNK_CHARS
    ? inputText.slice(0, MAX_CHUNK_CHARS)
    : inputText;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: text,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const json = await res.json();

    if (!res.ok || json.error) {
      console.error('Embedding API error:', json.error);
      throw new Error(json.error?.message || 'Failed to generate embedding.');
    }

    return json.data[0].embedding;
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('Embedding API request timed out after 30 seconds');
    }
    throw err;
  }
}


/**
 * Generate embeddings for all pages using block-based chunking.
 * Blocks are grouped into chunks that respect Logseq's block boundaries.
 * Each chunk includes the page header (id, name) for context.
 */
export async function getEmbedingsAllNotes(apiKey: string, model: string = DEFAULT_EMBEDDING_MODEL): Promise<VectorDBSchemaDynamic[]> {
  const BATCH_SIZE = 5;
  const pages = (await logseq.Editor.getAllPages()) ?? [];
  const allNotesEmbeddings: VectorDBSchemaDynamic[] = [];

  for (let i = 0; i < pages.length; i += BATCH_SIZE) {
    const batch = pages.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (page) => {
        try {
          const blocks = await logseq.Editor.getPageBlocksTree(page.uuid);
          const pageHeader = `note_id: ${page.id}\nnote_name: ${page.name}\nnote_content:\n\n`;
          const blockLines = await flattenBlocks(blocks);
          const chunks = groupBlocksIntoChunks(blockLines, pageHeader);

          const chunkEmbeddings: VectorDBSchemaDynamic[] = [];
          for (let c = 0; c < chunks.length; c++) {
            try {
              const chunkId = chunks.length === 1
                ? page.id.toString()
                : `${page.id}_chunk_${c}`;
              const embedding: VectorDBSchemaDynamic = {
                id: chunkId,
                lastUpdated: page.updatedAt ?? 0,
                content: chunks[c],
                embedding: await useGenerateEmbedding(chunks[c], apiKey, model)
              };
              chunkEmbeddings.push(embedding);
            } catch (err: any) {
              console.error('Embedding failed for page:', page.name, 'chunk:', c, err);
              // Continue batch — don't abort other pages
            }
          }
          return chunkEmbeddings;
        } catch (err: any) {
          console.error(`Embedding failed for page "${page.name}":`, err);
          return []; // Skip this page, continue batch
        }
      })
    );
    for (const pageChunks of batchResults) {
      allNotesEmbeddings.push(...pageChunks);
    }
  }

  return allNotesEmbeddings;
}

/**
 * Generate block-based chunk embeddings for a single page.
 * Used by the incremental indexer (checkAndIndexUpdatedPages).
 */
export async function getEmbeddingsForPage(
  pageId: string,
  blocks: any[],
  pageName: string,
  lastUpdated: number,
  apiKey: string,
  model: string = DEFAULT_EMBEDDING_MODEL
): Promise<VectorDBSchemaDynamic[]> {
  const pageHeader = `note_id: ${pageId}\nnote_name: ${pageName}\nnote_content:\n\n`;
  const blockLines = await flattenBlocks(blocks);
  const chunks = groupBlocksIntoChunks(blockLines, pageHeader);
  const embeddings: VectorDBSchemaDynamic[] = [];

  for (let c = 0; c < chunks.length; c++) {
    const chunkId = chunks.length === 1
      ? pageId
      : `${pageId}_chunk_${c}`;
    const embedding: VectorDBSchemaDynamic = {
      id: chunkId,
      lastUpdated,
      content: chunks[c],
      embedding: await useGenerateEmbedding(chunks[c], apiKey, model)
    };
    embeddings.push(embedding);
  }

  return embeddings;
}
