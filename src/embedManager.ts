import { CrossPageDeduplicator, deduplicateBlocks } from './deduplicator';
import { normalizeBlockContent } from './normalizer';
import { countTokens, decode, encode } from './tokenizer';
import { buildSubtreeChunks } from './hierarchyChunker';

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

export type EmbeddingProvider = 'openai' | 'ollama' | 'litellm';

export const OPENAI_EMBEDDINGS_ENDPOINT = 'https://api.openai.com/v1/embeddings';

export const EMBEDDING_MODELS: Record<string, EmbeddingModelConfig> = {
  'text-embedding-ada-002': { name: 'text-embedding-ada-002', dimensions: 1536, maxTokens: 8191 },
  'text-embedding-3-small': { name: 'text-embedding-3-small', dimensions: 1536, maxTokens: 8191 },
  'text-embedding-3-large': { name: 'text-embedding-3-large', dimensions: 3072, maxTokens: 8191 },
  'nomic-embed-text':       { name: 'nomic-embed-text',       dimensions: 768,  maxTokens: 8192 },
  'mxbai-embed-large':      { name: 'mxbai-embed-large',      dimensions: 1024, maxTokens: 512  },
  'all-minilm':             { name: 'all-minilm',             dimensions: 384,  maxTokens: 256  },
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

export interface BlockMetadataEntry {
  uuid: string;
  pageName: string;
  contentPreview: string;
}

export interface ChunkDepthMetadata {
  rootDepth: number;
  hasHeading: boolean;
}

export interface BlockLine {
  content: string;
  isHeading: boolean;
  depth: number;       // nesting depth (0 = top-level)
  groupId: number;     // semantic group ID (-1 if ungrouped)
}

/**
 * Identify semantic groups: a heading block + all its children.
 * Returns block lines annotated with group membership.
 *
 * A heading block and all subsequent blocks at deeper depth form a semantic
 * group, until the next heading at the same or shallower depth.
 * Non-heading blocks that aren't part of any group get groupId: -1.
 *
 * Uses the original content (pre-normalization) to detect heading markers,
 * since normalization strips `#` prefixes.
 */
export function identifySemanticGroups(blockLines: string[]): BlockLine[] {
  const parsed: BlockLine[] = blockLines.map((line) => {
    const { content, depth } = parseBlockLine(line);
    const isHeading = /^#{1,6}\s+/.test(content);
    return { content: line, isHeading, depth, groupId: -1 };
  });

  let groupId = 0;

  for (let i = 0; i < parsed.length; i++) {
    if (!parsed[i].isHeading) continue;

    const headingDepth = parsed[i].depth;
    parsed[i].groupId = groupId;

    // Collect all subsequent blocks at deeper depth
    let j = i + 1;
    while (j < parsed.length) {
      if (parsed[j].depth <= headingDepth) break;
      parsed[j].groupId = groupId;
      j++;
    }

    groupId++;
    // Skip past children already assigned to this group
    i = j - 1; // eslint-disable-line
  }

  return parsed;
}

/**
 * Parse a flattened block line to extract the raw content and nesting depth.
 * - Top-level lines: `- content` → depth 0
 * - Nested lines: `[a > b > c] content` → depth = number of `>` + 1
 */
function parseBlockLine(line: string): { content: string; depth: number } {
  // Check for breadcrumb prefix: [parent > child > ...] content
  const breadcrumbMatch = line.match(/^\[([^\]]*)\]\s*(.*)/);
  if (breadcrumbMatch) {
    const breadcrumb = breadcrumbMatch[1];
    const content = breadcrumbMatch[2];
    // Depth = number of segments in the breadcrumb chain
    const segments = breadcrumb.split('>').length;
    return { content, depth: segments };
  }

  // Top-level line: `- content`
  const topLevelMatch = line.match(/^- (.*)/);
  if (topLevelMatch) {
    return { content: topLevelMatch[1], depth: 0 };
  }

  // Fallback: treat as top-level
  return { content: line, depth: 0 };
}

export interface PageLinkData {
  outgoingLinks: string[];   // page names from [[link]] syntax
  backlinks: string[];       // page names that link TO this page
}

/**
 * Extract outgoing page links from flattened block content.
 * Parses [[page_name]] patterns and returns a deduplicated array of page names.
 */
export function extractOutgoingLinks(blockLines: string[]): string[] {
  const linkRegex = /\[\[(.+?)\]\]/g;
  const seen = new Set<string>();
  for (const line of blockLines) {
    let match: RegExpExecArray | null;
    while ((match = linkRegex.exec(line)) !== null) {
      seen.add(match[1]);
    }
  }
  return [...seen];
}

/**
 * Fetch backlinks for a page using the Logseq API.
 * Returns an array of page names that link to the given page.
 * Returns an empty array if the API call fails or no backlinks exist.
 */
export async function fetchBacklinks(pageName: string): Promise<string[]> {
  try {
    const refs = await logseq.Editor.getPageLinkedReferences(pageName);
    if (!refs || !Array.isArray(refs)) {
      return [];
    }
    // Each entry is a [page, blocks[]] tuple — extract the page name
    const names: string[] = [];
    for (const entry of refs) {
      const page = entry?.[0];
      if (page?.name) {
        names.push(page.name);
      } else if (page?.originalName) {
        names.push(page.originalName);
      }
    }
    return names;
  } catch (err) {
    console.warn(`Failed to fetch backlinks for "${pageName}" (Logseq API issue, skipping):`, err);
    return [];
  }
}

/** Default overlap as fraction of previous chunk's block lines */
export const OVERLAP_FRACTION = 0.15;

/** Max fraction of chunk char limit that overlap lines may consume */
export const MAX_OVERLAP_BUDGET = 0.20;

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
 * Format block properties as a compact string.
 * Skips internal/system keys (id, uuid, etc.) to avoid noise.
 */
function formatBlockProperties(properties?: Record<string, any>): string {
  if (!properties || Object.keys(properties).length === 0) return '';
  const skipKeys = new Set(['id', 'uuid', 'collapsed', 'ls-type', 'heading', 'logseq.order-list-type']);
  const parts: string[] = [];
  for (const [key, value] of Object.entries(properties)) {
    if (skipKeys.has(key)) continue;
    const val = Array.isArray(value) ? value.join(', ') : String(value);
    if (val) parts.push(`${key}: ${val}`);
  }
  return parts.length > 0 ? ` {${parts.join('; ')}}` : '';
}

/**
 * Truncate content to at most 50 characters for use as a content preview.
 * Appends "…" if the content is truncated.
 */
export function createContentPreview(content: string): string {
  if (content.length <= 50) return content;
  return content.slice(0, 49) + '…';
}

export interface FlattenResult {
  lines: string[];
  metadata: BlockMetadataEntry[];
}

/**
 * Recursively flatten a block tree into a list of content strings.
 * Preserves Logseq's block hierarchy by prefixing each child block
 * with its parent chain as a breadcrumb (e.g. "parent > child > grandchild").
 * This makes each block line self-contained with full context.
 * Appends block properties (priority, status, etc.) when present.
 * Resolves block references ((uuid)) and embeds {{embed ((uuid))}} to actual content.
 * Also collects block metadata entries (uuid, pageName, contentPreview) for blocks with UUIDs.
 */
export async function flattenBlocks(blocks: any[], parentChain: string[] = [], pageName?: string): Promise<FlattenResult> {
  const lines: string[] = [];
  const metadata: BlockMetadataEntry[] = [];
  for (const block of blocks) {
    if (block.content) {
      const resolvedContent = await resolveBlockReferences(block.content);
      const props = formatBlockProperties(block.properties);
      let line: string;
      if (parentChain.length > 0) {
        const breadcrumb = parentChain.join(' > ');
        line = `[${breadcrumb}] ${resolvedContent}${props}`;
      } else {
        line = `- ${resolvedContent}${props}`;
      }
      // Prepend block UUID annotation when the block has a uuid property
      if (block.uuid) {
        line = `[block:${block.uuid}] ${line}`;
        // Collect block metadata for storage
        if (pageName) {
          metadata.push({
            uuid: block.uuid,
            pageName,
            contentPreview: createContentPreview(resolvedContent),
          });
        }
      }
      lines.push(line);
      if (block.children && block.children.length > 0) {
        const shortContent = resolvedContent.length > 60
          ? resolvedContent.slice(0, 60) + '…'
          : resolvedContent;
        const childResult = await flattenBlocks(block.children, [...parentChain, shortContent], pageName);
        lines.push(...childResult.lines);
        metadata.push(...childResult.metadata);
      }
    } else if (block.children && block.children.length > 0) {
      const childResult = await flattenBlocks(block.children, parentChain, pageName);
      lines.push(...childResult.lines);
      metadata.push(...childResult.metadata);
    }
  }
  return { lines, metadata };
}

/**
 * Group block lines into chunks that fit within the embedding model's token limit.
 * Supports semantic grouping (keeping heading groups together) and chunk overlap.
 *
 * - Blocks with the same groupId (not -1) form a semantic group.
 * - Semantic groups are kept together when they fit; split between child blocks when they don't.
 * - After finalizing each chunk, overlap lines from its tail are prepended to the next chunk.
 * - Single-chunk pages produce no overlap.
 */
export function groupBlocksIntoChunks(
  blockLines: BlockLine[],
  pageHeader: string,
  maxTokens: number,
  overlapFraction: number = OVERLAP_FRACTION
): string[] {
  if (blockLines.length === 0) {
    return [pageHeader];
  }

  const contentBudget = maxTokens - countTokens(pageHeader);
  const overlapBudgetTokens = Math.floor(maxTokens * MAX_OVERLAP_BUDGET);

  // --- Collect semantic groups as runs of consecutive same-groupId lines ---
  interface Segment {
    lines: BlockLine[];
    groupId: number;
  }

  const segments: Segment[] = [];
  let i = 0;
  while (i < blockLines.length) {
    const bl = blockLines[i];
    if (bl.groupId !== -1) {
      // Collect all consecutive lines with the same groupId
      const groupLines: BlockLine[] = [bl];
      let j = i + 1;
      while (j < blockLines.length && blockLines[j].groupId === bl.groupId) {
        groupLines.push(blockLines[j]);
        j++;
      }
      segments.push({ lines: groupLines, groupId: bl.groupId });
      i = j;
    } else {
      // Ungrouped line — individual segment
      segments.push({ lines: [bl], groupId: -1 });
      i++;
    }
  }

  // --- Build chunks from segments ---
  // Each "raw chunk" is an array of BlockLine references (before overlap is applied).
  const rawChunks: BlockLine[][] = [];
  let currentLines: BlockLine[] = [];
  let currentLen = 0; // token count of content in currentLines (excluding header)

  function flushCurrent() {
    if (currentLines.length > 0) {
      rawChunks.push(currentLines);
      currentLines = [];
      currentLen = 0;
    }
  }

  function lineTokenLen(bl: BlockLine): number {
    return countTokens(bl.content + '\n');
  }

  function segmentTokenLen(seg: Segment): number {
    return seg.lines.reduce((sum, bl) => sum + lineTokenLen(bl), 0);
  }

  for (const seg of segments) {
    const segLen = segmentTokenLen(seg);

    if (seg.groupId !== -1) {
      // --- Semantic group handling ---
      if (currentLen + segLen <= contentBudget) {
        // Fits in current chunk
        currentLines.push(...seg.lines);
        currentLen += segLen;
      } else if (segLen <= contentBudget) {
        // Doesn't fit in current, but fits in a fresh chunk
        flushCurrent();
        currentLines = [...seg.lines];
        currentLen = segLen;
      } else {
        // Oversized group — split between child blocks (never mid-block)
        flushCurrent();
        for (const bl of seg.lines) {
          const blLen = lineTokenLen(bl);
          if (currentLen + blLen <= contentBudget) {
            currentLines.push(bl);
            currentLen += blLen;
          } else {
            flushCurrent();
            if (blLen <= contentBudget) {
              currentLines = [bl];
              currentLen = blLen;
            } else {
              // Single block exceeds budget — split at token boundaries
              const tokens = encode(bl.content);
              let offset = 0;
              while (offset < tokens.length) {
                const sliceTokens = tokens.slice(offset, offset + contentBudget);
                const sliceText = decode(sliceTokens);
                rawChunks.push([{
                  content: sliceText,
                  isHeading: bl.isHeading,
                  depth: bl.depth,
                  groupId: bl.groupId
                }]);
                offset += contentBudget;
              }
            }
          }
        }
      }
    } else {
      // --- Ungrouped line: existing adjacency-based behavior ---
      const bl = seg.lines[0];
      const blLen = lineTokenLen(bl);

      if (currentLen + blLen <= contentBudget) {
        currentLines.push(bl);
        currentLen += blLen;
      } else {
        flushCurrent();
        if (blLen <= contentBudget) {
          currentLines = [bl];
          currentLen = blLen;
        } else {
          // Single block exceeds budget — split at token boundaries
          const tokens = encode(bl.content);
          let offset = 0;
          while (offset < tokens.length) {
            const sliceTokens = tokens.slice(offset, offset + contentBudget);
            const sliceText = decode(sliceTokens);
            rawChunks.push([{
              content: sliceText,
              isHeading: bl.isHeading,
              depth: bl.depth,
              groupId: bl.groupId
            }]);
            offset += contentBudget;
          }
        }
      }
    }
  }
  flushCurrent();

  // --- Single-chunk pages produce no overlap ---
  if (rawChunks.length <= 1) {
    return rawChunks.map(
      (lines) => pageHeader + lines.map((bl) => bl.content + '\n').join('')
    );
  }

  // --- Apply overlap between chunks ---
  const finalChunks: string[] = [];
  let overlapLines: BlockLine[] = [];

  for (let ci = 0; ci < rawChunks.length; ci++) {
    const chunkBlockLines = rawChunks[ci];

    // Build chunk text: header + overlap lines + new content
    let chunkText = pageHeader;
    if (ci > 0 && overlapLines.length > 0) {
      chunkText += overlapLines.map((bl) => bl.content + '\n').join('');
    }
    chunkText += chunkBlockLines.map((bl) => bl.content + '\n').join('');

    // Truncate via encode/decode if overlap pushed chunk over the token limit
    if (countTokens(chunkText) > maxTokens) {
      const tokens = encode(chunkText);
      chunkText = decode(tokens.slice(0, maxTokens));
    }

    finalChunks.push(chunkText);

    // Compute overlap for the next chunk
    const overlapCount = Math.ceil(chunkBlockLines.length * overlapFraction);
    let candidateOverlap = chunkBlockLines.slice(chunkBlockLines.length - overlapCount);

    // Cap overlap at the token budget
    let overlapTokenLen = candidateOverlap.reduce((sum, bl) => sum + countTokens(bl.content + '\n'), 0);
    while (candidateOverlap.length > 0 && overlapTokenLen > overlapBudgetTokens) {
      candidateOverlap = candidateOverlap.slice(1);
      overlapTokenLen = candidateOverlap.reduce((sum, bl) => sum + countTokens(bl.content + '\n'), 0);
    }

    overlapLines = candidateOverlap;
  }

  return finalChunks;
}

export function resolveEndpoint(endpoint?: string): string {
  return endpoint?.trim() || OPENAI_EMBEDDINGS_ENDPOINT;
}

export async function useGenerateEmbedding(
  inputText: string,
  apiKey: string,
  model: string = DEFAULT_EMBEDDING_MODEL,
  endpoint: string = OPENAI_EMBEDDINGS_ENDPOINT,
  provider: EmbeddingProvider = 'openai'
): Promise<number[]> {
  if (provider === 'openai' && !apiKey?.trim()) {
    throw new Error('Embedding API key is not configured. Please set your OpenAI API key in the plugin settings.');
  }

  const resolvedEndpoint = resolveEndpoint(endpoint);

  // Safety truncation for any single chunk that still exceeds the model's limit
  const config = EMBEDDING_MODELS[model];
  const tokens = encode(inputText);
  const text = tokens.length > config.maxTokens
    ? decode(tokens.slice(0, config.maxTokens))
    : inputText;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  let body: string;

  if (provider === 'ollama') {
    body = JSON.stringify({ model, prompt: text });
  } else {
    // OpenAI and LiteLLM both use the OpenAI-compatible format
    if (apiKey?.trim()) headers['Authorization'] = `Bearer ${apiKey}`;
    body = JSON.stringify({ model, input: text });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(resolvedEndpoint, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const bodyText = await res.text();
      throw new Error(`Embedding API error (HTTP ${res.status}): ${bodyText}`);
    }

    const json = await res.json();

    const embedding = provider === 'ollama' ? json.embedding : json.data?.[0]?.embedding;

    if (!embedding) {
      throw new Error(`Unexpected embedding response format from ${provider}: missing embedding data`);
    }

    return embedding;
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('Embedding API request timed out after 30 seconds');
    }
    if (provider === 'ollama' && (err.cause?.code === 'ECONNREFUSED' || err.message?.includes('ECONNREFUSED') || err.message?.includes('fetch failed') || err.type === 'system')) {
      throw new Error(`Ollama embedding endpoint is not reachable at ${resolvedEndpoint}. Please verify Ollama is running.`);
    }
    throw err;
  }
}


/**
 * Build the page header string that prefixes each chunk.
 * Includes page id, name, tags (if any), and optional graph context
 * (outgoing links and backlinks) for richer semantic context.
 */
export function buildPageHeader(
  pageId: string | number,
  pageName: string,
  properties?: Record<string, any>,
  linkData?: PageLinkData
): string {
  let header = `note_id: ${pageId}\nnote_name: ${pageName}\n`;
  const tags = properties?.tags;
  if (tags) {
    const tagList = Array.isArray(tags) ? tags.join(', ') : String(tags);
    if (tagList) {
      header += `note_tags: ${tagList}\n`;
    }
  }
  if (linkData?.outgoingLinks && linkData.outgoingLinks.length > 0) {
    header += `note_links: ${linkData.outgoingLinks.join(', ')}\n`;
  }
  if (linkData?.backlinks && linkData.backlinks.length > 0) {
    header += `note_backlinks: ${linkData.backlinks.join(', ')}\n`;
  }
  header += `note_content:\n\n`;
  return header;
}

/**
 * Generate embeddings for all pages using block-based chunking.
 * Blocks are grouped into chunks that respect Logseq's block boundaries.
 * Each chunk includes the page header (id, name, tags) for context.
 */
export async function getEmbedingsAllNotes(apiKey: string, model: string = DEFAULT_EMBEDDING_MODEL): Promise<VectorDBSchemaDynamic[]> {
  const BATCH_SIZE = 5;
  const maxTokens = EMBEDDING_MODELS[model].maxTokens;
  const pages = (await logseq.Editor.getAllPages()) ?? [];
  const allNotesEmbeddings: VectorDBSchemaDynamic[] = [];
  const crossPageDedup = new CrossPageDeduplicator();

  for (let i = 0; i < pages.length; i += BATCH_SIZE) {
    const batch = pages.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (page) => {
        try {
          const blocks = await logseq.Editor.getPageBlocksTree(page.uuid);
          const { lines: originalLines } = await flattenBlocks(blocks);

          // Normalize block content (strip markdown formatting)
          const normalizedLines = originalLines.map((line) => normalizeBlockContent(line));

          // Deduplicate within-page
          const withinPageDeduped = deduplicateBlocks(normalizedLines);

          // Deduplicate across pages
          const crossPageDeduped = withinPageDeduped.filter(
            (line) => crossPageDedup.tryAdd(line)
          );

          // Build a mapping from normalized line → original line for heading detection.
          // identifySemanticGroups() needs original content to detect `#` heading markers.
          const normalizedToOriginal = new Map<string, string>();
          for (let idx = 0; idx < originalLines.length; idx++) {
            const norm = normalizedLines[idx];
            if (!normalizedToOriginal.has(norm)) {
              normalizedToOriginal.set(norm, originalLines[idx]);
            }
          }
          const originalForGrouping = crossPageDeduped.map(
            (norm) => normalizedToOriginal.get(norm) ?? norm
          );

          // Identify semantic groups using original content (heading markers intact)
          const semanticBlockLines = identifySemanticGroups(originalForGrouping);

          // Replace BlockLine.content with normalized text for embedding
          for (let idx = 0; idx < semanticBlockLines.length; idx++) {
            semanticBlockLines[idx].content = crossPageDeduped[idx];
          }

          // Extract graph context
          const outgoingLinks = extractOutgoingLinks(originalLines);
          const backlinks = await fetchBacklinks(page.name);
          const linkData: PageLinkData = { outgoingLinks, backlinks };

          const pageHeader = buildPageHeader(page.id, page.name, page.properties, linkData);
          const subtreeChunks = buildSubtreeChunks(semanticBlockLines, { maxTokens, pageHeader });

          const chunkEmbeddings: VectorDBSchemaDynamic[] = [];
          for (let c = 0; c < subtreeChunks.length; c++) {
            try {
              const chunkId = subtreeChunks.length === 1
                ? page.id.toString()
                : `${page.id}_chunk_${c}`;
              const embedding: VectorDBSchemaDynamic = {
                id: chunkId,
                lastUpdated: page.updatedAt ?? 0,
                content: subtreeChunks[c].content,
                embedding: await useGenerateEmbedding(subtreeChunks[c].content, apiKey, model)
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
 *
 * Pipeline: flatten → normalize → deduplicate (within-page) → semantic group → chunk → embed.
 * Semantic grouping uses original (pre-normalization) content to detect heading markers,
 * since normalization strips `#` prefixes.
 */
export async function getEmbeddingsForPage(
  pageId: string,
  blocks: any[],
  pageName: string,
  lastUpdated: number,
  apiKey: string,
  model: string = DEFAULT_EMBEDDING_MODEL,
  properties?: Record<string, any>,
  linkData?: PageLinkData,
  endpoint?: string,
  provider?: EmbeddingProvider
): Promise<{ embeddings: VectorDBSchemaDynamic[]; blockMetadata: BlockMetadataEntry[]; chunkDepthMetadata: ChunkDepthMetadata[] }> {
  const { lines: originalLines, metadata: blockMetadata } = await flattenBlocks(blocks, [], pageName);

  // Normalize block content (strip markdown formatting)
  const normalizedLines = originalLines.map((line) => normalizeBlockContent(line));

  // Deduplicate within-page only (no cross-page scan for incremental indexing)
  const dedupedLines = deduplicateBlocks(normalizedLines);

  // Build a mapping from normalized line → original line for heading detection.
  // identifySemanticGroups() needs original content to detect `#` heading markers.
  const normalizedToOriginal = new Map<string, string>();
  for (let idx = 0; idx < originalLines.length; idx++) {
    const norm = normalizedLines[idx];
    if (!normalizedToOriginal.has(norm)) {
      normalizedToOriginal.set(norm, originalLines[idx]);
    }
  }
  const originalForGrouping = dedupedLines.map(
    (norm) => normalizedToOriginal.get(norm) ?? norm
  );

  // Identify semantic groups using original content (heading markers intact)
  const semanticBlockLines = identifySemanticGroups(originalForGrouping);

  // Replace BlockLine.content with normalized text for embedding
  for (let idx = 0; idx < semanticBlockLines.length; idx++) {
    semanticBlockLines[idx].content = dedupedLines[idx];
  }

  const pageHeader = buildPageHeader(pageId, pageName, properties, linkData);
  const maxTokens = EMBEDDING_MODELS[model].maxTokens;
  const subtreeChunks = buildSubtreeChunks(semanticBlockLines, { maxTokens, pageHeader });
  const embeddings: VectorDBSchemaDynamic[] = [];
  const chunkDepthMetadata: ChunkDepthMetadata[] = [];

  for (let c = 0; c < subtreeChunks.length; c++) {
    const chunkId = subtreeChunks.length === 1
      ? pageId
      : `${pageId}_chunk_${c}`;
    const embedding: VectorDBSchemaDynamic = {
      id: chunkId,
      lastUpdated,
      content: subtreeChunks[c].content,
      embedding: await useGenerateEmbedding(subtreeChunks[c].content, apiKey, model, endpoint, provider)
    };
    embeddings.push(embedding);
    chunkDepthMetadata.push({
      rootDepth: subtreeChunks[c].rootDepth,
      hasHeading: subtreeChunks[c].hasHeading,
    });
  }

  return { embeddings, blockMetadata, chunkDepthMetadata };
}
