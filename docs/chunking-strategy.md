# Chunking Strategy

## Current Approach: Block-Based Chunking

The plugin chunks pages by Logseq's native unit — the block. Blocks are recursively flattened (including nested child blocks), block references and embeds are resolved to actual content, and adjacent blocks are grouped into chunks that respect block boundaries. No block is ever split mid-content.

## How It Works

For each page, the plugin:

1. Fetches the page's block tree via `logseq.Editor.getPageBlocksTree()`
2. Recursively flattens all blocks (including nested children) with indentation reflecting depth
3. Resolves block references `((uuid))` and block embeds `{{embed ((uuid))}}` to actual content
4. Groups adjacent block lines into chunks up to ~16,000 characters (derived from the model's 8,191 token limit × 2 chars/token)
5. Prepends page metadata (id, name) to each chunk for context
6. Each chunk gets its own embedding and database record

## Block Flattening

The `flattenBlocks()` function recursively traverses the entire block tree:

```
Top-level block A
  Child block A.1
    Grandchild block A.1.1
  Child block A.2
Top-level block B
```

Becomes:

```
[block:uuid-a] - Block A content
[block:uuid-a1] [Block A content…] Block A.1 content
[block:uuid-a11] [Block A content… > Block A.1 content…] Block A.1.1 content
[block:uuid-a2] [Block A content…] Block A.2 content
[block:uuid-b] - Block B content
```

Each block line is prefixed with a `[block:<uuid>]` annotation when the block has a UUID and non-empty content. Child blocks include a breadcrumb trail showing their parent context. These annotations are embedded in the chunk text so that when chunks are retrieved during search, the LLM can see which block each piece of content came from and cite it using `((uuid))` notation.

Blocks without a UUID or with empty content do not receive an annotation.

## Block Reference Resolution

Before embedding, block content is scanned for two patterns:

| Pattern                        | Example                          | Resolution                              |
|-------------------------------|----------------------------------|-----------------------------------------|
| Block reference               | `((64a1b2c3-d4e5-...))`         | Replaced with the referenced block's text |
| Block embed                   | `{{embed ((64a1b2c3-d4e5-...))}}` | Replaced with the embedded block's text   |

Resolution uses `logseq.Editor.getBlock(uuid)` to fetch the actual content. A cache (`refCache`) prevents redundant API calls when the same block is referenced multiple times. The cache is cleared before each indexing run.

If a referenced block can't be fetched (deleted, invalid UUID), the original syntax is kept as fallback.

## Chunk Grouping

Adjacent block lines are grouped into chunks using `groupBlocksIntoChunks()`:

1. Start with the page header as the initial chunk content
2. Append block lines one by one
3. When adding a line would exceed the chunk character limit (~16,000 chars), finalize the current chunk and start a new one
4. The new chunk starts with the page header again (so every chunk has page context)
5. Block lines are never split — the boundary is always between complete blocks

### Example

A page with 50 blocks where blocks 1-30 fit in one chunk and blocks 31-50 fit in another:

| Chunk   | ID                  | Content                                    |
|---------|--------------------|--------------------------------------------|
| Chunk 0 | `{pageId}_chunk_0` | Page header + blocks 1-30                  |
| Chunk 1 | `{pageId}_chunk_1` | Page header + blocks 31-50                 |

If the entire page fits in one chunk, the record uses the plain page ID (no `_chunk_` suffix).

## Chunk IDs

| Scenario              | ID Format              | Example          |
|----------------------|------------------------|------------------|
| Single chunk (short page) | `{pageId}`          | `42`             |
| Multiple chunks       | `{pageId}_chunk_{n}`   | `42_chunk_0`, `42_chunk_1` |

## Page Metadata Header

Every chunk is prefixed with:

```
note_id: {page.id}
note_name: {page.name}
note_content:

```

This ensures the embedding model and LLM know which page the blocks belong to, even when viewing a chunk in isolation.

## Block Metadata Storage

During indexing, the plugin also populates a `block_metadata` table that maps each block's UUID to its parent page name and a short content preview (first 50 characters, truncated with "…"). This metadata is used at render time to display meaningful labels on clickable block references and to navigate to the correct page when a block reference is clicked.

| Column         | Type       | Description                                      |
|---------------|------------|--------------------------------------------------|
| uuid          | TEXT (PK)  | Block UUID from Logseq                           |
| pageName      | TEXT       | Parent page name                                 |
| contentPreview| TEXT       | First 50 chars of block content (truncated with "…") |

When a page is re-indexed, its old block metadata is deleted before new records are inserted. A full re-index clears all block metadata.

## What Gets Chunked

| Content Type              | Handling                                              |
|--------------------------|-------------------------------------------------------|
| Top-level blocks         | Included with `- ` prefix and `[block:uuid]` annotation |
| Nested/child blocks      | Included with breadcrumb context and `[block:uuid]` annotation |
| Block references `(())`  | Resolved to actual referenced block content            |
| Block embeds `{{embed}}` | Resolved to actual embedded block content              |
| Journal pages            | Included (individual journal entries like "Apr 15th")  |
| Internal pages           | Skipped (cards, contents, favorites, `__*`, "journals" index) |
| Empty blocks             | Skipped (only blocks with content are included)        |

## Limitations

- **No semantic grouping**: Blocks are grouped by adjacency and size, not by topic. Two unrelated blocks next to each other may share a chunk.
- **Single block overflow**: If a single block's content exceeds the chunk limit, it gets its own chunk and is truncated by the safety limit in `useGenerateEmbedding()`.
- **No overlap between chunks**: Unlike sliding-window chunking, there's no overlap. Context at chunk boundaries may be split between two chunks.
- **Reference resolution depth**: Only one level of references is resolved. If a referenced block itself contains references, those nested references are not resolved.
- **Cache scope**: The reference cache is per-indexing-run. References resolved during auto-indexing may use stale cache entries within the same run.

## Configuration

| Parameter       | Value   | Location              | Description                          |
|----------------|---------|----------------------|--------------------------------------|
| CHARS_PER_TOKEN | 2       | `src/embedManager.ts` | Conservative chars-per-token ratio    |
| maxTokens      | 8191    | `src/embedManager.ts` | Model token limit (all 3 models)      |
| Max chunk chars | ~16,382 | Derived               | `maxTokens × CHARS_PER_TOKEN`         |

Not currently exposed as a plugin setting.

## File Reference

| File                   | Relevant Code                                                |
|-----------------------|--------------------------------------------------------------|
| `src/embedManager.ts` | `flattenBlocks()` (recursive block traversal with UUID annotation), `resolveBlockReferences()` (reference resolution), `groupBlocksIntoChunks()` (chunk grouping), `createContentPreview()` (block metadata preview truncation), `getEmbedingsAllNotes()` (full indexing), `getEmbeddingsForPage()` (incremental indexing, returns embeddings + block metadata) |
| `src/indexManager.ts`  | `checkAndIndexUpdatedPages()` (incremental indexing with chunk cleanup via `deleteDocuments` + `upsertDocuments`, block metadata via `upsertBlockMetadata` + `deleteBlockMetadataForPage`) |
| `src/storage/SQLiteVectorStore.ts` | Per-document storage of chunks (each chunk is a row in the `documents` table), block metadata storage (`block_metadata` table with `upsertBlockMetadata`, `deleteBlockMetadataForPage`, `clearBlockMetadata`, `getBlockMetadata`) |
