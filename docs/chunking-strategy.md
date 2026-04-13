# Chunking Strategy

## Current Approach: Whole-Page Embedding (No Chunking)

The plugin currently does **not** chunk pages. Each Logseq page is embedded as a single document — the entire page content is concatenated into one string and sent to the embedding API as-is (with truncation if it exceeds the character limit).

## How It Works

For each page, the plugin:

1. Fetches the page's block tree via `logseq.Editor.getPageBlocksTree()`
2. Concatenates all top-level blocks into a single string with metadata:

```
note_id: {page.id}
note_name: {page.name}
note_content:

- {block 1 content}
- {block 2 content}
- {block 3 content}
...
```

3. If the resulting string exceeds 25,000 characters, it is truncated to 25,000 characters (hard cutoff, no semantic boundary awareness)
4. The entire string is sent as one input to `text-embedding-ada-002`
5. One embedding vector (1536 dimensions) is stored per page

## Granularity

| Unit       | Embedding Count | Description                        |
|-----------|----------------|------------------------------------|
| Per page  | 1              | Entire page content = 1 vector     |
| Per block | Not supported  | Individual blocks are not embedded |
| Per chunk | Not supported  | No sub-page splitting              |

## Implications

### Strengths

- **Simple**: One page = one embedding = one database record. Easy to index, update, and delete.
- **Fast lookups**: The page ID is the database key. Checking if a page needs re-indexing is a single `getByID()` call.
- **Low API cost**: One API call per page regardless of page length.

### Limitations

- **Truncation loses content**: Pages longer than ~8,000 tokens (25,000 chars) are silently truncated. Content beyond the cutoff is never embedded and won't appear in search results.
- **Diluted embeddings**: For long pages covering multiple topics, the embedding represents an average of all topics. A search for a specific detail buried in a long page may not match well.
- **No block-level retrieval**: Search returns entire pages, not specific blocks. The LLM receives the full page content as context, even if only one block is relevant.
- **Nested blocks ignored**: Only top-level blocks are included. Child blocks (indented content) from `getPageBlocksTree()` are not traversed — only `element.content` of the top-level array is concatenated.

## Truncation Details

- **Limit**: 25,000 characters
- **Method**: Hard `string.slice(0, 25000)` — no awareness of word, sentence, or block boundaries
- **Location**: Applied in `useGenerateEmbedding()` before the API call, so it affects all embedding paths (bulk indexing, incremental indexing, and query embedding)
- **Rationale**: `text-embedding-ada-002` has an 8,191 token limit. At variable tokenization rates (3-4 chars/token depending on content), 25,000 chars provides a safe margin.

## What's Not Chunked

| Content Type          | Handling                                    |
|----------------------|---------------------------------------------|
| Long pages (>25k chars) | Truncated, tail content lost             |
| Multi-topic pages    | Single embedding averages all topics        |
| Nested/child blocks  | Not included in the page content string     |
| Journal pages        | Skipped entirely (filtered as internal)     |
| Internal pages       | Skipped (cards, contents, favorites, `__*`) |

## Potential Improvements

These are not implemented — documented here for future reference.

### Block-Level Chunking
Split each page into individual blocks, embed each block separately. This would improve retrieval precision for specific content but increases API cost and database size proportionally.

### Sliding Window Chunking
Split long pages into overlapping chunks (e.g., 2,000 tokens with 200-token overlap). This preserves context across chunk boundaries and ensures no content is lost to truncation.

### Semantic Chunking
Group related blocks together based on content similarity or heading structure. This balances precision and cost but adds complexity.

### Recursive Block Traversal
Traverse child blocks (nested content) in addition to top-level blocks. Currently only `element.content` of the top-level block tree is used — indented sub-blocks are not included.

## File Reference

| File                   | Relevant Code                                                |
|-----------------------|--------------------------------------------------------------|
| `src/embedManager.ts` | `MAX_INPUT_CHARS` (truncation limit), `getEmbedingsAllNotes()` (page content assembly), `useGenerateEmbedding()` (truncation applied) |
| `src/indexManager.ts`  | `checkAndIndexUpdatedPages()` (page content assembly for incremental indexing) |
