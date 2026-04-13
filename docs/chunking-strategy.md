# Chunking Strategy

## Current Approach: Block-Based Chunking

The plugin chunks pages by Logseq's native unit — the block. Blocks are recursively flattened (including nested child blocks), block references and embeds are resolved to actual content, and adjacent blocks are grouped into chunks that respect block boundaries. No block is ever split mid-content.

## How It Works

For each page, the plugin:

1. Fetches the page's block tree via `logseq.Editor.getPageBlocksTree()`
2. Recursively flattens all blocks (including nested children) with indentation reflecting depth
3. Resolves block references `((uuid))` and block embeds `{{embed ((uuid))}}` to actual content
4. Groups adjacent block lines into chunks up to 24,000 characters
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
- Block A content
  - Block A.1 content
    - Block A.1.1 content
  - Block A.2 content
- Block B content
```

Indentation uses two spaces per depth level, preserving the hierarchy visually.

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
3. When adding a line would exceed 24,000 characters, finalize the current chunk and start a new one
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

## What Gets Chunked

| Content Type              | Handling                                              |
|--------------------------|-------------------------------------------------------|
| Top-level blocks         | Included with `- ` prefix                             |
| Nested/child blocks      | Included with indentation reflecting depth             |
| Block references `(())`  | Resolved to actual referenced block content            |
| Block embeds `{{embed}}` | Resolved to actual embedded block content              |
| Journal pages            | Included (individual journal entries like "Apr 15th")  |
| Internal pages           | Skipped (cards, contents, favorites, `__*`, "journals" index) |
| Empty blocks             | Skipped (only blocks with content are included)        |

## Limitations

- **No semantic grouping**: Blocks are grouped by adjacency and size, not by topic. Two unrelated blocks next to each other may share a chunk.
- **Single block overflow**: If a single block's content exceeds 24,000 characters, it gets its own chunk and is truncated by the safety limit in `useGenerateEmbedding()`.
- **No overlap between chunks**: Unlike sliding-window chunking, there's no overlap. Context at chunk boundaries may be split between two chunks.
- **Reference resolution depth**: Only one level of references is resolved. If a referenced block itself contains references, those nested references are not resolved.
- **Cache scope**: The reference cache is per-indexing-run. References resolved during auto-indexing may use stale cache entries within the same run.

## Configuration

| Parameter       | Value   | Location              | Description                          |
|----------------|---------|----------------------|--------------------------------------|
| MAX_CHUNK_CHARS | 24000   | `src/embedManager.ts` | Maximum characters per chunk          |

Not currently exposed as a plugin setting.

## File Reference

| File                   | Relevant Code                                                |
|-----------------------|--------------------------------------------------------------|
| `src/embedManager.ts` | `flattenBlocks()` (recursive block traversal), `resolveBlockReferences()` (reference resolution), `groupBlocksIntoChunks()` (chunk grouping), `getEmbedingsAllNotes()` (full indexing), `getEmbeddingsForPage()` (incremental indexing) |
| `src/indexManager.ts`  | `checkAndIndexUpdatedPages()` (incremental indexing with chunk cleanup) |
