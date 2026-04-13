# Embedding Strategy

## Overview

Logseq Composer uses OpenAI's `text-embedding-ada-002` model to generate vector embeddings for all user notes. These embeddings power semantic search via RAG (Retrieval-Augmented Generation), allowing the LLM to find and reference relevant notes when answering queries.

## Embedding Model

- **Model**: `text-embedding-ada-002`
- **Vector dimensions**: 1536
- **Max token limit**: 8,191 tokens
- **Max input chars**: 24,000 characters per chunk (safety limit to stay within token limit)

## Vector Database

The plugin uses [Orama](https://github.com/oramasearch/orama) as an in-memory vector database with the following schema:

| Field        | Type           | Description                          |
|-------------|----------------|--------------------------------------|
| id          | string         | Page ID or `{pageId}_chunk_{n}` for multi-chunk pages |
| content     | string         | Block content for this chunk         |
| lastUpdated | number         | Timestamp of last page update        |
| embedding   | vector[1536]   | 1536-dimensional embedding vector    |

### Persistence

The database is serialized to JSON using `@orama/plugin-data-persistence` and stored in Logseq's plugin settings under the `VectorDBLogseqCopilot` key. On plugin load, the database is restored from this persisted JSON. If the stored data is missing or corrupted, a fresh database is created automatically.

## Block-Based Content Processing

Each page's content is processed block by block:

1. The block tree is fetched via `logseq.Editor.getPageBlocksTree()`
2. All blocks are recursively flattened, including nested children with indentation
3. Block references `((uuid))` and embeds `{{embed ((uuid))}}` are resolved to actual content
4. Blocks are grouped into chunks that respect block boundaries (see [Chunking Strategy](./chunking-strategy.md))
5. Each chunk is prefixed with page metadata:

```
note_id: {page.id}
note_name: {page.name}
note_content:

- {block 1 content}
  - {child block content}
- {block 2 content}
...
```

## Indexing Modes

Controlled by the `indexingMode` plugin setting.

### Incremental (default)

- Loads the existing vector database
- Iterates all pages and compares each page's `updatedAt` timestamp against the stored `lastUpdated`
- Skips pages that haven't changed since last indexed
- For updated pages: removes old records and chunks, generates new block-based chunk embeddings, and inserts them
- Skips internal pages (cards, contents, favorites, journals index, pages starting with `__`)
- Journal pages (individual entries like "Apr 15th, 2026") are included

### Full

- Creates a fresh empty database (discards all existing embeddings)
- Generates block-based chunk embeddings for every page in the vault
- Processes pages in batches of 5 concurrent API calls
- Clears the block reference cache before starting

## Indexing Triggers

There are three ways embedding/indexing occurs:

### 1. Manual Re-Index (Re-Index DB button)

The user clicks the green "Re-Index DB" button in the chat panel. This calls `indexEntireLogSeq()` which behaves according to the `indexingMode` setting (incremental or full).

### 2. Auto-Indexing on Page Changes

When the plugin loads, it registers a `logseq.DB.onChanged()` listener via `enableAutoIndexer()`. Any database change in Logseq (page edits, new pages, etc.) triggers `checkAndIndexUpdatedPages()`, which performs incremental indexing for changed pages.

A guard flag (`isUpdatingSettings`) prevents cascading re-indexing loops. When the plugin persists the vector database to settings, the resulting `onChanged` event is ignored.

An `indexingInProgress` flag with a 1-second cooldown prevents concurrent indexing runs.

### 3. Query-Time Embedding

When the user sends a chat message, `handleQuery()` generates a single embedding for the query text to perform vector similarity search against the indexed notes. This is not a bulk indexing operation — it's a single API call per query.

## Concurrency and Rate Limiting

- **Batch size**: 5 pages processed concurrently per batch (full indexing mode)
- **Timeout**: Each API call has a 30-second timeout via `AbortController`. If the API doesn't respond within 30 seconds, the request is aborted with a descriptive error.
- **Incremental indexing**: Processes pages sequentially (one at a time) since it typically only needs to handle a few changed pages.

## Block Reference Resolution

Block references and embeds are resolved before embedding:

| Pattern                        | Resolution                                          |
|-------------------------------|-----------------------------------------------------|
| `((uuid))`                    | Replaced with the referenced block's actual text     |
| `{{embed ((uuid))}}`          | Replaced with the embedded block's actual text       |

A per-run cache prevents redundant `logseq.Editor.getBlock()` calls for the same UUID. If a reference can't be resolved, the original syntax is preserved.

## Vector Search

When the user sends a query:

1. The query text is embedded using the same `text-embedding-ada-002` model
2. The embedding is searched against the Orama database using vector similarity
3. Search parameters:
   - **Similarity threshold**: 0.65 (minimum cosine similarity)
   - **Result limit**: 5 most similar chunks
   - **Vectors excluded** from results (only document content is returned)
4. The content of matching chunks is appended to the LLM prompt as "Additional Context from Knowledge Base"

If vector search fails for any reason, the query proceeds without additional context — only the current page context is used as fallback.

## Error Handling

- **API errors**: The actual error message from OpenAI is surfaced to the user, including the page name that failed
- **Timeout**: Requests that exceed 30 seconds are aborted with "Embedding API request timed out after 30 seconds"
- **Token limit**: Input is capped at 24,000 characters per chunk; block-based chunking ensures most content fits naturally
- **Database corruption**: If the persisted database can't be restored, a fresh database is created automatically
- **Per-page resilience** (auto-indexer): If embedding fails for one page during auto-indexing, the error is logged and indexing continues for remaining pages
- **Reference resolution failure**: If a block reference can't be fetched, the original `((uuid))` syntax is kept

## Architecture Diagram

```
┌─────────────────────────────────────────────────┐
│                   User Actions                   │
├──────────┬──────────────────┬───────────────────┤
│ Re-Index │  Send Chat Query │  Edit a Page      │
│ DB Button│                  │  (auto-trigger)   │
└────┬─────┴────────┬─────────┴─────────┬─────────┘
     │              │                   │
     ▼              ▼                   ▼
 indexEntire     handleQuery()    DB.onChanged()
 LogSeq()            │                  │
     │               │                  ▼
     │               │         checkAndIndex
     │               │         UpdatedPages()
     ▼               │                  │
 ┌───────────────────┼──────────────────┘
 │                   │
 ▼                   ▼
 flattenBlocks()     useGenerateEmbedding()
 (recursive, with    (query embedding)
  ref resolution)         │
     │                    │
     ▼                    │
 groupBlocksIntoChunks()  │
     │                    │
     ▼                    ▼
 ┌───────────────────────────────────────┐
 │      useGenerateEmbedding()           │
 │  (OpenAI text-embedding-ada-002)      │
 │  - 30s timeout                        │
 │  - 24,000 char safety limit           │
 └──────────────┬────────────────────────┘
                │
                ▼
 ┌───────────────────────────────────────┐
 │     Orama Vector Database             │
 │  - insertMultiple / remove            │
 │  - vector search (cosine sim)         │
 │  - persist to Logseq settings         │
 └───────────────────────────────────────┘
```

## File Reference

| File                    | Responsibility                                              |
|------------------------|-------------------------------------------------------------|
| `src/embedManager.ts`  | Block flattening, reference resolution, chunk grouping, embedding generation |
| `src/VectorDBManager.ts` | Database CRUD, persistence, vector search                  |
| `src/indexManager.ts`  | Incremental indexing, auto-index on change, re-index guard   |
| `src/manager.ts`       | Orchestration: manual re-index, auto-indexer, query handling |
| `src/settings.ts`      | Plugin settings schema including indexing mode               |
