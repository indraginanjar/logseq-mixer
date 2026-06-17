// src/hierarchyChunker.ts
//
// Hierarchy-aware chunker that produces subtree-based chunks from a block tree,
// respecting Logseq's parent-child block structure.

import type { BlockLine } from './embedManager';
import { OVERLAP_FRACTION, MAX_OVERLAP_BUDGET } from './embedManager';
import { countTokens, encode, decode } from './tokenizer';

/** Default ancestor truncation length when combined context exceeds budget */
const DEFAULT_ANCESTOR_TRUNCATE_LENGTH = 60;

/**
 * A subtree-based chunk produced by the hierarchy chunker.
 * Each chunk is rooted at a block and contains its descendants,
 * bounded by the token limit.
 */
export interface SubtreeChunk {
  /** Full chunk text (header + ancestor context + subtree content) */
  content: string;
  /** Depth of the chunk's root block (0-indexed) */
  rootDepth: number;
  /** Whether the chunk contains a heading block (# prefix) */
  hasHeading: boolean;
  /** The BlockLine entries in this chunk (for overlap computation) */
  blockLines: BlockLine[];
}

/**
 * Options for the hierarchy chunker.
 */
export interface HierarchyChunkerOptions {
  /** Token budget from embedding model config */
  maxTokens: number;
  /** Pre-built page header string */
  pageHeader: string;
  /** Default: OVERLAP_FRACTION (0.15) */
  overlapFraction?: number;
  /** Default: 60 characters */
  ancestorTruncateLength?: number;
}

/**
 * Build ancestor context string for a block at a given position.
 * Traverses up the hierarchy to collect parent content as breadcrumbs.
 *
 * The function walks backward through the blockLines array from `blockIndex`
 * to find all ancestor blocks (blocks at shallower depths that form the
 * parent chain). Ancestors are formatted as a breadcrumb chain separated
 * by " > ".
 *
 * When the combined ancestor context exceeds the truncate budget,
 * each ancestor is truncated to `truncateLength` characters.
 */
export function buildAncestorContext(
  blockLines: BlockLine[],
  blockIndex: number,
  truncateLength: number = DEFAULT_ANCESTOR_TRUNCATE_LENGTH
): string {
  if (blockIndex < 0 || blockIndex >= blockLines.length) {
    return '';
  }

  const targetDepth = blockLines[blockIndex].depth;
  if (targetDepth === 0) {
    return '';
  }

  // Collect ancestors by traversing upward through the block tree.
  // An ancestor is the nearest preceding block at each shallower depth level.
  const ancestors: string[] = [];
  let lookingForDepth = targetDepth - 1;

  for (let i = blockIndex - 1; i >= 0 && lookingForDepth >= 0; i--) {
    if (blockLines[i].depth === lookingForDepth) {
      ancestors.unshift(blockLines[i].content);
      lookingForDepth--;
    } else if (blockLines[i].depth < lookingForDepth) {
      // We found a block at an even shallower depth — it's an ancestor too,
      // and we skipped levels. Add it and adjust what we're looking for.
      ancestors.unshift(blockLines[i].content);
      lookingForDepth = blockLines[i].depth - 1;
    }
  }

  if (ancestors.length === 0) {
    return '';
  }

  // Check if combined context exceeds budget and truncate if needed
  const fullContext = ancestors.join(' > ');
  if (fullContext.length > truncateLength * ancestors.length) {
    const truncated = ancestors.map((a) =>
      a.length > truncateLength ? a.slice(0, truncateLength) + '…' : a
    );
    return truncated.join(' > ');
  }

  return fullContext;
}

/**
 * Compute the depth weight for a given root depth.
 * Formula: max(1.0 - depth * 0.1, 0.5)
 * Heading chunks always return 1.0.
 */
export function computeDepthWeight(rootDepth: number, hasHeading: boolean): number {
  if (hasHeading) {
    return 1;
  }
  return Math.max(1 - rootDepth * 0.1, 0.5);
}

// ─── Subtree Chunking ──────────────────────────────────────────────────────────

/**
 * Count tokens for a block line (content + newline).
 */
function blockTokenLen(bl: BlockLine): number {
  return countTokens(bl.content + '\n');
}

/**
 * Get the subtree rooted at `startIndex` — all blocks following it
 * that have a strictly greater depth, in depth-first order.
 * Returns [startIndex, endIndex) range (exclusive end).
 */
function getSubtreeRange(blockLines: BlockLine[], startIndex: number): { start: number; end: number } {
  const rootDepth = blockLines[startIndex].depth;
  let end = startIndex + 1;
  while (end < blockLines.length && blockLines[end].depth > rootDepth) {
    end++;
  }
  return { start: startIndex, end };
}

/**
 * Get immediate children indices for a block at `parentIndex`.
 * Immediate children are the next-level blocks (depth === parentDepth + 1)
 * that appear before another block at the same or shallower depth as the parent.
 */
function getImmediateChildIndices(blockLines: BlockLine[], parentIndex: number): number[] {
  const parentDepth = blockLines[parentIndex].depth;
  const childDepth = parentDepth + 1;
  const children: number[] = [];
  for (let i = parentIndex + 1; i < blockLines.length; i++) {
    if (blockLines[i].depth <= parentDepth) break;
    if (blockLines[i].depth === childDepth) {
      children.push(i);
    }
  }
  return children;
}

/**
 * Compute token cost for a set of block lines (content + newlines).
 */
function computeBlocksTokens(blocks: BlockLine[]): number {
  let total = 0;
  for (const bl of blocks) {
    total += blockTokenLen(bl);
  }
  return total;
}

/**
 * Truncate a single block's content to fit within the given token budget.
 * Returns a new BlockLine with truncated content.
 */
function truncateBlock(bl: BlockLine, maxTokens: number): BlockLine {
  const tokens = encode(bl.content);
  // Leave room for the newline (1 token approx)
  const truncated = decode(tokens.slice(0, maxTokens));
  return { ...bl, content: truncated };
}

/**
 * Build subtree-based chunks from a block tree.
 *
 * Each chunk is rooted at a block and contains its descendants,
 * bounded by the token limit. Ancestor context is prepended for chunks
 * whose root block is not at depth 0. The page header is prepended to
 * every chunk.
 *
 * The algorithm:
 * 1. Walk top-level blocks (depth 0 or root-level blocks)
 * 2. For each top-level block, try to fit its entire subtree into a chunk
 * 3. If heading group cohesion applies, keep heading + children together
 * 4. Split oversized subtrees at child block boundaries
 * 5. Apply overlap between adjacent chunks
 */
export function buildSubtreeChunks(
  blockLines: BlockLine[],
  options: HierarchyChunkerOptions
): SubtreeChunk[] {
  const {
    maxTokens,
    pageHeader,
    overlapFraction = OVERLAP_FRACTION,
    ancestorTruncateLength = DEFAULT_ANCESTOR_TRUNCATE_LENGTH,
  } = options;

  if (blockLines.length === 0) {
    // Return a single chunk with just the page header
    return [{
      content: pageHeader,
      rootDepth: 0,
      hasHeading: false,
      blockLines: [],
    }];
  }

  const headerTokens = countTokens(pageHeader);

  // Raw chunks before overlap is applied.
  // Each entry stores the block lines and associated metadata.
  interface RawChunk {
    blocks: BlockLine[];
    rootDepth: number;
    hasHeading: boolean;
    ancestorContext: string;
  }

  const rawChunks: RawChunk[] = [];

  // Current chunk being built
  let currentBlocks: BlockLine[] = [];
  let currentTokens = 0;
  let currentRootDepth = 0;
  let currentHasHeading = false;
  let currentAncestorContext = '';
  let currentAncestorTokens = 0;

  function flushCurrent(): void {
    if (currentBlocks.length > 0) {
      rawChunks.push({
        blocks: [...currentBlocks],
        rootDepth: currentRootDepth,
        hasHeading: currentHasHeading,
        ancestorContext: currentAncestorContext,
      });
    }
    currentBlocks = [];
    currentTokens = 0;
    currentRootDepth = 0;
    currentHasHeading = false;
    currentAncestorContext = '';
    currentAncestorTokens = 0;
  }

  function startNewChunk(rootBlockIndex: number): void {
    const ancestorCtx = buildAncestorContext(blockLines, rootBlockIndex, ancestorTruncateLength);
    currentAncestorContext = ancestorCtx;
    currentAncestorTokens = ancestorCtx ? countTokens(ancestorCtx + '\n') : 0;
    currentRootDepth = blockLines[rootBlockIndex].depth;
    currentHasHeading = false;
    currentTokens = 0;
  }

  /**
   * Try to add a subtree (starting at subtreeStart, ending before subtreeEnd)
   * to the current chunk. If it fits, add it. If not, handle splitting.
   */
  function addSubtree(subtreeStart: number, subtreeEnd: number, inheritedAncestorContext?: string): void {
    const subtreeBlocks = blockLines.slice(subtreeStart, subtreeEnd);
    const subtreeTokens = computeBlocksTokens(subtreeBlocks);
    const rootBlock = blockLines[subtreeStart];

    // Determine ancestor context for this subtree if starting a fresh chunk
    const ancestorCtx = inheritedAncestorContext !== undefined
      ? inheritedAncestorContext
      : buildAncestorContext(blockLines, subtreeStart, ancestorTruncateLength);
    const ancestorTok = ancestorCtx ? countTokens(ancestorCtx + '\n') : 0;

    // Case: empty current chunk — try to fit entire subtree
    if (currentBlocks.length === 0) {
      startNewChunk(subtreeStart);
      if (inheritedAncestorContext !== undefined) {
        currentAncestorContext = inheritedAncestorContext;
        currentAncestorTokens = ancestorTok;
      }
      const currentBudget = maxTokens - headerTokens - currentAncestorTokens;

      if (subtreeTokens <= currentBudget) {
        // Entire subtree fits
        currentBlocks = subtreeBlocks;
        currentTokens = subtreeTokens;
        currentHasHeading = currentHasHeading || subtreeBlocks.some(b => b.isHeading);
        return;
      }

      // Subtree doesn't fit — need to split
      // Handle heading group cohesion: if root is a heading, try to keep heading + children
      if (rootBlock.isHeading) {
        handleHeadingSubtreeSplit(subtreeStart, subtreeEnd, currentBudget);
        return;
      }

      // Not a heading — split at child boundaries
      splitSubtreeAtChildren(subtreeStart, subtreeEnd, currentBudget, ancestorCtx);
      return;
    }

    // Case: current chunk has content — try to append subtree
    const currentBudget = maxTokens - headerTokens - currentAncestorTokens;
    if (currentTokens + subtreeTokens <= currentBudget) {
      // Fits in current chunk
      currentBlocks.push(...subtreeBlocks);
      currentTokens += subtreeTokens;
      currentHasHeading = currentHasHeading || subtreeBlocks.some(b => b.isHeading);
      return;
    }

    // Doesn't fit — finalize current chunk and try in a new one
    flushCurrent();
    addSubtree(subtreeStart, subtreeEnd, inheritedAncestorContext);
  }

  /**
   * Handle splitting a heading's subtree: heading goes in first chunk,
   * children get split across subsequent chunks with heading as ancestor context.
   */
  function handleHeadingSubtreeSplit(subtreeStart: number, subtreeEnd: number, budget: number): void {
    const headingBlock = blockLines[subtreeStart];
    const headingTokens = blockTokenLen(headingBlock);

    // If the heading alone exceeds budget, truncate it
    if (headingTokens > budget) {
      const truncated = truncateBlock(headingBlock, budget);
      currentBlocks = [truncated];
      currentTokens = budget;
      currentHasHeading = true;
      flushCurrent();
      // Process children with heading as ancestor context
      processChildrenWithHeadingContext(subtreeStart, subtreeEnd);
      return;
    }

    // Add heading block to current chunk
    currentBlocks = [headingBlock];
    currentTokens = headingTokens;
    currentHasHeading = true;

    // Try to add immediate children that fit (heading group cohesion)
    const childIndices = getImmediateChildIndices(blockLines, subtreeStart);

    for (const childIdx of childIndices) {
      const childRange = getSubtreeRange(blockLines, childIdx);
      const childBlocks = blockLines.slice(childRange.start, childRange.end);
      const childTokens = computeBlocksTokens(childBlocks);

      if (currentTokens + childTokens <= budget) {
        // Child subtree fits — add it
        currentBlocks.push(...childBlocks);
        currentTokens += childTokens;
        currentHasHeading = currentHasHeading || childBlocks.some(b => b.isHeading);
      } else {
        // Can't fit this child — flush and start splitting remaining children
        flushCurrent();
        // Build ancestor context that includes the heading
        const headingAncestorBase = buildAncestorContext(blockLines, subtreeStart, ancestorTruncateLength);
        const headingContent = headingBlock.content.length > ancestorTruncateLength
          ? headingBlock.content.slice(0, ancestorTruncateLength) + '…'
          : headingBlock.content;
        const childAncestorCtx = headingAncestorBase
          ? headingAncestorBase + ' > ' + headingContent
          : headingContent;

        // Process this child and remaining children with heading ancestor context
        for (let ci = childIndices.indexOf(childIdx); ci < childIndices.length; ci++) {
          const cIdx = childIndices[ci];
          const cRange = getSubtreeRange(blockLines, cIdx);
          addSubtree(cRange.start, cRange.end, childAncestorCtx);
        }
        return;
      }
    }

    // All children fit — chunk is complete (or subtree was just the heading)
  }

  /**
   * Process children of a heading with the heading included as ancestor context.
   */
  function processChildrenWithHeadingContext(subtreeStart: number, subtreeEnd: number): void {
    const headingBlock = blockLines[subtreeStart];
    const headingAncestorBase = buildAncestorContext(blockLines, subtreeStart, ancestorTruncateLength);
    const headingContent = headingBlock.content.length > ancestorTruncateLength
      ? headingBlock.content.slice(0, ancestorTruncateLength) + '…'
      : headingBlock.content;
    const childAncestorCtx = headingAncestorBase
      ? headingAncestorBase + ' > ' + headingContent
      : headingContent;

    const childIndices = getImmediateChildIndices(blockLines, subtreeStart);
    for (const childIdx of childIndices) {
      const childRange = getSubtreeRange(blockLines, childIdx);
      addSubtree(childRange.start, childRange.end, childAncestorCtx);
    }
  }

  /**
   * Split a non-heading subtree at child block boundaries.
   * The root block goes into the current chunk, then children are added
   * one by one until budget is exhausted.
   */
  function splitSubtreeAtChildren(subtreeStart: number, subtreeEnd: number, budget: number, ancestorCtx: string): void {
    const rootBlock = blockLines[subtreeStart];
    const rootTokens = blockTokenLen(rootBlock);

    // If root block alone exceeds budget, truncate it
    if (rootTokens > budget) {
      const truncated = truncateBlock(rootBlock, budget);
      currentBlocks = [truncated];
      currentTokens = budget;
      currentHasHeading = rootBlock.isHeading;
      flushCurrent();
      // Process children with root as ancestor context
      const rootContent = rootBlock.content.length > ancestorTruncateLength
        ? rootBlock.content.slice(0, ancestorTruncateLength) + '…'
        : rootBlock.content;
      const childAncestorCtx = ancestorCtx
        ? ancestorCtx + ' > ' + rootContent
        : rootContent;
      const childIndices = getImmediateChildIndices(blockLines, subtreeStart);
      for (const childIdx of childIndices) {
        const childRange = getSubtreeRange(blockLines, childIdx);
        addSubtree(childRange.start, childRange.end, childAncestorCtx);
      }
      return;
    }

    // Add root block to current chunk
    currentBlocks = [rootBlock];
    currentTokens = rootTokens;
    currentHasHeading = rootBlock.isHeading;

    // Add children one at a time
    const childIndices = getImmediateChildIndices(blockLines, subtreeStart);
    for (let ci = 0; ci < childIndices.length; ci++) {
      const childIdx = childIndices[ci];
      const childRange = getSubtreeRange(blockLines, childIdx);
      const childBlocks = blockLines.slice(childRange.start, childRange.end);
      const childTokens = computeBlocksTokens(childBlocks);

      if (currentTokens + childTokens <= budget) {
        // Fits in current chunk
        currentBlocks.push(...childBlocks);
        currentTokens += childTokens;
        currentHasHeading = currentHasHeading || childBlocks.some(b => b.isHeading);
      } else {
        // Can't fit — flush current and process this child in a new chunk
        flushCurrent();
        addSubtree(childRange.start, childRange.end, ancestorCtx);
      }
    }
  }

  // ─── Main loop: walk top-level blocks ─────────────────────────────────────────

  // Find the minimum depth in the block tree (it may not always start at 0)
  const minDepth = Math.min(...blockLines.map(b => b.depth));

  let i = 0;
  while (i < blockLines.length) {
    const block = blockLines[i];

    if (block.depth === minDepth) {
      // Top-level block — process its subtree
      const range = getSubtreeRange(blockLines, i);

      // If current chunk is empty, just process the subtree
      if (currentBlocks.length === 0) {
        addSubtree(range.start, range.end);
      } else {
        // Try to add this sibling subtree to the current chunk
        const subtreeBlocks = blockLines.slice(range.start, range.end);
        const subtreeTokens = computeBlocksTokens(subtreeBlocks);
        const currentBudget = maxTokens - headerTokens - currentAncestorTokens;

        if (currentTokens + subtreeTokens <= currentBudget) {
          currentBlocks.push(...subtreeBlocks);
          currentTokens += subtreeTokens;
          currentHasHeading = currentHasHeading || subtreeBlocks.some(b => b.isHeading);
        } else {
          // Doesn't fit — finalize current chunk and start fresh
          flushCurrent();
          addSubtree(range.start, range.end);
        }
      }

      i = range.end;
    } else {
      // Block not at min depth without a preceding parent — treat as standalone
      // This shouldn't happen with well-formed trees, but handle gracefully
      if (currentBlocks.length === 0) {
        startNewChunk(i);
      }
      const blTokens = blockTokenLen(block);
      const currentBudget = maxTokens - headerTokens - currentAncestorTokens;

      if (currentTokens + blTokens <= currentBudget) {
        currentBlocks.push(block);
        currentTokens += blTokens;
        currentHasHeading = currentHasHeading || block.isHeading;
      } else {
        flushCurrent();
        startNewChunk(i);
        const budget = maxTokens - headerTokens - currentAncestorTokens;
        if (blTokens <= budget) {
          currentBlocks.push(block);
          currentTokens = blTokens;
          currentHasHeading = block.isHeading;
        } else {
          // Single oversized block — truncate
          const truncated = truncateBlock(block, budget);
          currentBlocks = [truncated];
          currentTokens = budget;
          currentHasHeading = block.isHeading;
          flushCurrent();
        }
      }
      i++;
    }
  }

  // Flush any remaining content
  flushCurrent();

  // ─── Single-chunk pages get no overlap ────────────────────────────────────────

  if (rawChunks.length <= 1) {
    return rawChunks.map(chunk => {
      let content = pageHeader;
      if (chunk.ancestorContext) {
        content += chunk.ancestorContext + '\n';
      }
      content += chunk.blocks.map(bl => bl.content + '\n').join('');

      // Final truncation safety net
      if (countTokens(content) > maxTokens) {
        const tokens = encode(content);
        content = decode(tokens.slice(0, maxTokens));
      }

      return {
        content,
        rootDepth: chunk.rootDepth,
        hasHeading: chunk.hasHeading,
        blockLines: chunk.blocks,
      };
    });
  }

  // ─── Apply overlap between chunks ────────────────────────────────────────────

  const finalChunks: SubtreeChunk[] = [];
  const overlapBudgetTokens = Math.floor(maxTokens * MAX_OVERLAP_BUDGET);

  for (let ci = 0; ci < rawChunks.length; ci++) {
    const chunk = rawChunks[ci];
    let chunkBlocks = [...chunk.blocks];

    // Add overlap from previous chunk (except for the first chunk)
    if (ci > 0) {
      const prevChunk = rawChunks[ci - 1];
      const prevBlockCount = prevChunk.blocks.length;

      // Cap: last block of previous chunk, limited to 15% of previous chunk's block count
      const maxOverlapBlocks = Math.max(1, Math.ceil(prevBlockCount * overlapFraction));
      // Take the last block(s) from previous chunk as overlap
      let overlapBlocks = prevChunk.blocks.slice(-maxOverlapBlocks);

      // Cap overlap at 20% of token budget
      let overlapTokens = computeBlocksTokens(overlapBlocks);
      while (overlapBlocks.length > 0 && overlapTokens > overlapBudgetTokens) {
        overlapBlocks = overlapBlocks.slice(1);
        overlapTokens = computeBlocksTokens(overlapBlocks);
      }

      if (overlapBlocks.length > 0) {
        chunkBlocks = [...overlapBlocks, ...chunkBlocks];
      }
    }

    // Build final content: pageHeader + ancestorContext + blocks
    let content = pageHeader;
    if (chunk.ancestorContext) {
      content += chunk.ancestorContext + '\n';
    }
    content += chunkBlocks.map(bl => bl.content + '\n').join('');

    // Truncate if overlap pushed us over the limit
    if (countTokens(content) > maxTokens) {
      const tokens = encode(content);
      content = decode(tokens.slice(0, maxTokens));
    }

    finalChunks.push({
      content,
      rootDepth: chunk.rootDepth,
      hasHeading: chunk.hasHeading,
      blockLines: chunkBlocks,
    });
  }

  return finalChunks;
}
