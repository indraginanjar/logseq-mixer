# Chunking Strategy

## Current Approach: Hierarchy-Aware Subtree Chunking

The plugin chunks pages respecting Logseq's hierarchical parent-child block structure. Blocks are recursively flattened, block references and embeds are resolved to their actual content, semantic groups are identified, and the blocks are grouped into chunks using a token-budget-aware hierarchy chunker. To preserve semantic context across chunk boundaries, parent ancestor chains are prepended as breadcrumbs, and overlapping blocks are carried over between adjacent chunks.

---

## How It Works

For each page, the plugin runs the following processing pipeline:

1. **Fetch Blocks**: Retrieves the page's block tree via `logseq.Editor.getPageBlocksTree()`.
2. **Flatten Hierarchy**: Recursively flattens all blocks (including nested children) using `flattenBlocks()`, formatting children with parent context breadcrumbs (`[parent > child] content`) and appending block properties (attributes).
3. **Resolve References**: Scans block content for block references `((uuid))` and block embeds `{{embed ((uuid))}}` and resolves them to their actual referenced block content via `resolveBlockReferences()`.
4. **Identify Semantic Groups**: Groups headings and their subsequent child subtrees into semantic units using `identifySemanticGroups()`.
5. **Compute Token Lengths**: Evaluates the size of each block line using the real tokenizer (`countTokens()`) against the selected embedding model's maximum token limit (e.g., 8,191 tokens for OpenAI models).
6. **Subtree Chunking**: Groups the block tree into cohesive chunks rooted at subtrees via `buildSubtreeChunks()`.
7. **Prepend Context Headers**: Prepends a rich page metadata header (id, name, tags, outgoing links, and backlinks) to each chunk to ensure the embedding model and the LLM understand the global context of every chunk.
8. **Prepend Ancestor Context**: Prepends parent breadcrumb context to chunks starting at a nested block depth.
9. **Apply Overlap**: Prepends overlapping block lines from the tail of the previous chunk onto the head of the next chunk.
10. **Store Block Metadata**: Extracts block UUIDs, parent page names, and content previews to populate the `block_metadata` table in SQLite for clickable citation link rendering.

---

## Block Flattening

The `flattenBlocks()` function recursively traverses the block tree:

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

Each block line is prefixed with a `[block:<uuid>]` annotation when the block has a UUID. Child blocks include a breadcrumb trail showing their parent context. These annotations are embedded in the chunk text so that when chunks are retrieved during search, the LLM can identify which block each piece of content came from and cite it using `((uuid))` notation.

---

## Block Reference & Embed Resolution

Before embedding, block content is scanned for references:

| Pattern | Example | Resolution |
| :--- | :--- | :--- |
| **Block reference** | `((64a1b2c3-d4e5-...))` | Replaced with the referenced block's text |
| **Block embed** | `{{embed ((64a1b2c3-d4e5-...))}}` | Replaced with the embedded block's text |

Resolution uses `logseq.Editor.getBlock(uuid)` to fetch the actual content. A per-run cache (`refCache`) prevents redundant API calls when the same block is referenced multiple times. If a referenced block cannot be retrieved, the original syntax is kept as fallback.

---

## Subtree Chunking Algorithm

The default chunking algorithm is implemented in `buildSubtreeChunks()`:

### 1. Heading Group Cohesion
Heading blocks (`# Heading`) and their nested children are kept together in the same chunk if they fit within the token budget. If the combined heading subtree exceeds the budget, the chunker splits the subtree at child boundaries and prepends the heading content as ancestor context to the subsequent chunks.

### 2. Ancestor Context Breadcrumbs
When a chunk begins at a nested child block, the chunker walks backward through the block tree to build a breadcrumb string of parent blocks (e.g., `Parent Block > Child Block`). If this context exceeds the truncation threshold (default: 60 characters per ancestor), ancestors are truncated to fit. This ancestor context is prepended to the chunk.

### 3. Chunk Overlap
To prevent loss of context at chunk boundaries, adjacent chunks share overlapping blocks. The chunker takes the last block lines of the previous chunk and prepends them to the next chunk:
- **Overlap limit**: Default is 15% (`OVERLAP_FRACTION = 0.15`) of the previous chunk's block count.
- **Budget cap**: The total token length of overlapping blocks cannot exceed 20% (`MAX_OVERLAP_BUDGET = 0.20`) of the total chunk token limit.
- **Single-chunk pages**: Pages that fit entirely within a single chunk do not receive any overlap.

---

## Alternative/Legacy Chunker: groupBlocksIntoChunks()

`groupBlocksIntoChunks()` is an alternative linear adjacency-based chunker kept in `src/embedManager.ts` and used primarily in tests. It splits block lines sequentially:
1. Groups consecutive blocks sharing a semantic group (heading group).
2. Fits as many semantic groups and single lines as possible into a chunk.
3. Finalizes the chunk when adding a block exceeds the budget, and carries over overlap lines to the next chunk.

---

## Chunk IDs

| Scenario | ID Format | Example |
| :--- | :--- | :--- |
| **Single chunk** (short page) | `{pageId}` | `42` |
| **Multiple chunks** (long page) | `{pageId}_chunk_{n}` | `42_chunk_0`, `42_chunk_1` |

---

## Page Metadata Header

Every chunk is prefixed with metadata to retain global page context:

```
note_id: {page.id}
note_name: {page.name}
note_tags: {tags} (optional)
note_links: {outgoing links} (optional)
note_backlinks: {backlinks} (optional)
note_content:
```

---

## Block Metadata Storage

During indexing, the plugin populates a `block_metadata` table to map block UUIDs to their parent page names and a short content preview (first 50 characters, truncated with "…"). This metadata is retrieved at query time to display helpful titles on clickable citations in the chat panel.

| Column | Type | Description |
| :--- | :--- | :--- |
| **`uuid`** | TEXT (PK) | Block UUID from Logseq |
| **`pageName`** | TEXT | Parent page name |
| **`contentPreview`** | TEXT | First 50 chars of block content (truncated with "…") |

---

## What Gets Chunked

| Content Type | Handling |
| :--- | :--- |
| **Top-level blocks** | Included with `- ` prefix and `[block:uuid]` annotation |
| **Nested/child blocks** | Included with breadcrumb context and `[block:uuid]` annotation |
| **Block references** | Resolved to actual referenced block content |
| **Block embeds** | Resolved to actual embedded block content |
| **Journal pages** | Included (individual journal entries like "Apr 15th") |
| **Internal pages** | Skipped (cards, contents, favorites, `__*`, "journals" index) |
| **Empty blocks** | Skipped (only blocks with content are included) |

---

## Limitations

- **Single block overflow**: If a single block's content exceeds the chunk limit, it is split across multiple chunks using raw token slices.
- **Cache scope**: The block reference cache is per-indexing-run. References resolved during auto-indexing may use stale cache entries within the same run.
- **Reference resolution depth**: Only one level of references is resolved. If a referenced block itself contains references, those nested references are not resolved recursively.

---

## File Reference

| File | Relevant Code |
| :--- | :--- |
| **`src/hierarchyChunker.ts`** | `buildSubtreeChunks()` (subtree-based chunking), `buildAncestorContext()` (ancestor context creation), `computeDepthWeight()` (subtree weight scoring). |
| **`src/embedManager.ts`** | `flattenBlocks()` (recursive block flattening), `resolveBlockReferences()` (resolving refs), `identifySemanticGroups()` (semantic grouping), `buildPageHeader()` (metadata prepending), `getEmbedingsAllNotes()` / `getEmbeddingsForPage()` (orchestrating chunking + embedding pipeline), `groupBlocksIntoChunks()` (sequential chunking). |
| **`src/indexManager.ts`** | `checkAndIndexUpdatedPages()` (calls single page embedding and handles SQLite CRUD). |
| **`src/storage/SQLiteVectorStore.ts`** | Stores chunks in the `documents` table and block navigation data in the `block_metadata` table. |
