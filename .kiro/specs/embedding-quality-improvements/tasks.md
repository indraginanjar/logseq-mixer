# Implementation Plan: Embedding Quality Improvements

## Overview

Implement six improvements to the Logseq Composer embedding pipeline: markdown normalization, content deduplication, semantic-aware chunking with overlap, graph-aware page headers, and query-time RRF reranking. New pure-function modules are created first, then existing modules are modified to integrate them following the pipeline order: flatten → normalize → deduplicate → semantic chunk with overlap → graph-aware header → embed → (query time) rerank.

## Tasks

- [x] 1. Create the Normalizer module
  - [x] 1.1 Create `src/normalizer.ts` with `normalizeBlockContent()` function
    - Implement regex-based stripping of markdown syntax: heading markers, bold, italic, strikethrough, highlight, checkbox, blockquote, inline code, and page links
    - Apply rules in the correct order (bold before italic to avoid partial matches)
    - Export the function for use by `embedManager.ts`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10_

- [x] 2. Create the Deduplicator module
  - [x] 2.1 Create `src/deduplicator.ts` with `deduplicateBlocks()` function
    - Implement within-page deduplication using exact string matching
    - Keep first occurrence, remove subsequent duplicates
    - Return the deduplicated array of block lines
    - _Requirements: 5.2, 5.3, 5.4, 5.5_
  - [x] 2.2 Add `CrossPageDeduplicator` class to `src/deduplicator.ts`
    - Implement `tryAdd(content: string): boolean` method using a `Set<string>`
    - Implement `clear()` method for resetting between indexing runs
    - _Requirements: 5.1, 5.6_

- [x] 3. Create the Reranker module
  - [x] 3.1 Create `src/reranker.ts` with `SearchHit`, `RankedHit` interfaces and `rerankWithRRF()` function
    - Tokenize query into lowercase terms
    - Compute keyword score per hit (count of matching query terms, case-insensitive)
    - Rank hits by keyword score (ties broken by original vector rank)
    - Compute RRF score: `1/(k + vectorRank) + 1/(k + keywordRank)` with k=60
    - Sort by RRF score descending, return top `limit` (default 5) results
    - Handle empty hits array gracefully (return empty array)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

- [x] 4. Checkpoint — Verify new modules compile
  - Ensure all new files (`src/normalizer.ts`, `src/deduplicator.ts`, `src/reranker.ts`) compile without errors. Ask the user if questions arise.

- [x] 5. Modify `embedManager.ts` for semantic-aware chunking with overlap
  - [x] 5.1 Add `BlockLine` interface and `identifySemanticGroups()` function
    - Define `BlockLine` type with `content`, `isHeading`, `depth`, `groupId` fields
    - Scan block lines for heading markers (`#` prefix) to identify semantic groups
    - Assign group IDs: heading + all subsequent deeper-depth blocks until next same/shallower heading
    - Non-heading ungrouped blocks get `groupId: -1`
    - _Requirements: 2.1, 2.5_
  - [x] 5.2 Modify `groupBlocksIntoChunks()` to accept `BlockLine[]` and support overlap + semantic grouping
    - Update function signature to accept `BlockLine[]` instead of `string[]`, add optional `overlapFraction` parameter (default 0.15)
    - Keep semantic groups together when they fit in current or fresh chunk
    - Split oversized groups between child blocks (never mid-block)
    - After finalizing each chunk, compute overlap lines from the tail of that chunk
    - Cap overlap at 20% of `maxChunkChars`
    - Prepend overlap lines to the next chunk before new content
    - Single-chunk pages produce no overlap
    - Add `OVERLAP_FRACTION` and `MAX_OVERLAP_BUDGET` constants
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.2, 2.3, 2.4_

- [x] 6. Modify `embedManager.ts` for graph-aware headers
  - [x] 6.1 Add `extractOutgoingLinks()` function and `PageLinkData` interface
    - Parse `[[page_name]]` patterns from flattened block lines
    - Return deduplicated array of page names
    - _Requirements: 3.1, 3.6_
  - [x] 6.2 Add `fetchBacklinks()` async function
    - Use `logseq.Editor.getPageLinkedReferences` (or equivalent) to retrieve backlinks
    - Return array of page names that link to the given page
    - _Requirements: 3.2, 3.3_
  - [x] 6.3 Modify `buildPageHeader()` to accept optional `PageLinkData` parameter
    - Add `note_links` field when outgoing links exist
    - Add `note_backlinks` field when backlinks exist
    - Omit each field when the respective array is empty
    - _Requirements: 3.1, 3.2, 3.4, 3.5_

- [x] 7. Integrate normalizer and deduplicator into the embedding pipeline
  - [x] 7.1 Modify `getEmbedingsAllNotes()` to call normalize → deduplicate → semantic chunk pipeline
    - After `flattenBlocks()`, apply `normalizeBlockContent()` to each block line
    - Apply `deduplicateBlocks()` (within-page) to the normalized lines
    - Instantiate `CrossPageDeduplicator` once per full indexing run and filter across pages
    - Call `identifySemanticGroups()` before passing to updated `groupBlocksIntoChunks()`
    - Pass link data (outgoing + backlinks) to `buildPageHeader()`
    - _Requirements: 5.1, 5.6, 6.11, 6.12_
  - [x] 7.2 Modify `getEmbeddingsForPage()` to call normalize → deduplicate → semantic chunk pipeline
    - After `flattenBlocks()`, apply `normalizeBlockContent()` to each block line
    - Apply `deduplicateBlocks()` (within-page only) to the normalized lines
    - Call `identifySemanticGroups()` before passing to updated `groupBlocksIntoChunks()`
    - Accept and pass link data to `buildPageHeader()`
    - _Requirements: 5.4, 5.5, 6.11, 6.12_

- [x] 8. Modify `indexManager.ts` to pass graph context through
  - [x] 8.1 Update `checkAndIndexUpdatedPages()` to fetch and pass link data
    - Call `extractOutgoingLinks()` on flattened block lines
    - Call `fetchBacklinks()` for each page
    - Pass `PageLinkData` to `getEmbeddingsForPage()`
    - _Requirements: 3.1, 3.2, 3.3_

- [x] 9. Checkpoint — Verify embedding pipeline compiles
  - Ensure all modifications to `src/embedManager.ts` and `src/indexManager.ts` compile without errors. Ask the user if questions arise.

- [x] 10. Integrate reranker into the retrieval pipeline
  - [x] 10.1 Modify `handleQuery()` in `src/manager.ts` to call `rerankWithRRF()` after vector search
    - Import `rerankWithRRF` from `reranker.ts`
    - Map vector search hits to `SearchHit[]` format
    - Call `rerankWithRRF(hits, query)` to get reranked results
    - Use reranked results to build the `vectorContext` string for the LLM prompt
    - Handle zero-result case (skip reranking)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

- [x] 11. Final checkpoint — Verify full build compiles
  - Ensure all files compile without errors and the full project builds cleanly. Ask the user if questions arise.

## Notes

- No schema changes are needed — the Orama vector DB schema remains identical
- All new modules (`normalizer.ts`, `deduplicator.ts`, `reranker.ts`) are pure functions with no external dependencies
- The pipeline order is: flatten → normalize → deduplicate → semantic chunk with overlap → graph-aware header → embed → (query time) rerank
- Semantic grouping uses original content (pre-normalization) to detect heading markers, since normalization strips `#` prefixes
- Each task references specific requirement acceptance criteria for traceability
