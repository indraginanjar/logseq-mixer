# Retrieval Strategy

## Overview

Logseq Composer uses Retrieval-Augmented Generation (RAG) to provide the LLM with relevant context from the user's notes. When a user sends a query, the plugin runs a hybrid search pipeline that combines BM25 keyword search with vector similarity search, merges results via Reciprocal Rank Fusion (RRF), and injects the top-ranked chunks into the LLM prompt alongside conversation history and the currently open page.

## Retrieval Pipeline

```
User Query
    │
    ├──────────────────────────────────┐
    ▼                                  ▼
┌──────────────────────────┐  ┌──────────────────────────┐
│ 1a. Classify query       │  │ 1b. Embed the query      │  useGenerateEmbedding(query)
│     classifyQuery(query) │  │     (selected model)     │
│     → keyword/semantic/  │  └────────────┬─────────────┘
│       mixed + weights    │               │
└────────────┬─────────────┘               │
             │                             │
             ├─────────────┬───────────────┤
             ▼             │               ▼
┌──────────────────────┐   │  ┌──────────────────────────┐
│ 2a. BM25 keyword     │   │  │ 2b. Vector similarity    │  storageProvider.searchByVector()
│     search            │   │  │     search (brute-force  │
│     bm25Index.search()│   │  │     cosine similarity)   │
│     - top 5 results   │   │  │     - threshold: 0.5     │
└──────────┬────────────┘   │  │     - top 5 results      │
           │                │  └────────────┬──────────────┘
           │                │               │
           ▼                │               ▼
┌──────────────────────────────────────────────┐
│ 3. Merge with RRF          mergeWithRRF()    │
│    - weighted by query classification        │
│    - deduplicate by chunk ID                 │
│    - top 5 fused results                     │
└────────────────────┬─────────────────────────┘
                     │
                     ▼
┌──────────────────────────┐
│ 4. Build LLM prompt      │
│    - System prompt        │
│    - Conversation history │
│    - Current page context │
│    - Retrieved documents  │
└────────────┬─────────────┘
             │
             ▼
┌──────────────────────────┐
│ 5. Query LLM via LiteLLM │  queryLiteLLM(prompt, model, apiKey, endpoint)
└──────────────────────────┘
```

## Step 1a: Query Embedding

The user's query text is embedded using the same model and API key used for indexing. The model is configurable (default: `text-embedding-3-small`), producing a 1536 or 3072-dimensional vector depending on the selected model.

- Same truncation rules apply (~16,000 char limit), though queries are typically short
- Same 30-second timeout applies
- If embedding fails, vector search is skipped entirely and the query proceeds with only the current page as context

## Step 1b: Query Classification

The query is classified by `classifyQuery()` to determine how to weight BM25 vs. vector results during RRF merging. The classifier uses heuristic detection of keyword indicators:

- URL patterns (`http://`, `https://`, domain-like strings)
- File paths (`/path/to/file`, `C:\path`, `./relative`)
- Code-like tokens (camelCase, snake_case, method calls, brackets/braces)
- Quoted phrases (text in single or double quotes)
- Special characters (regex-like patterns, `*`, `?`, `^`, etc.)

Decision logic: ≥2 indicators → `keyword`, 1 indicator → `mixed`, 0 indicators → `semantic`.

| Category   | `bm25Weight` | `vectorWeight` |
|-----------|-------------|---------------|
| `keyword`  | 1.5         | 0.5           |
| `mixed`    | 1.0         | 1.0           |
| `semantic` | 0.5         | 1.5           |

If the classifier throws, the pipeline defaults to `mixed` (equal weights).

## Step 2: Hybrid Search

For the default backend (SQLiteVectorStore), the pipeline runs BM25 keyword search and vector similarity search in parallel, then merges results via RRF. This is orchestrated by `hybridSearch()` in `src/hybridSearch.ts`.

### BM25 Keyword Search

An in-memory `BM25Index` is built from all document content in the SQLite `documents` table at initialization and kept in sync via upsert/delete/clear lifecycle hooks. At query time, the query is tokenized (split on whitespace/punctuation, lowercased) and scored against the index using the BM25 (Okapi BM25) ranking formula with parameters k1=1.2, b=0.75.

| Parameter | Value | Description                        |
|----------|-------|------------------------------------|
| limit    | 5     | Maximum number of BM25 results     |

### Vector Similarity Search

The `SQLiteVectorStore` reads all rows from the `documents` table, decodes each embedding BLOB to a `Float32Array`, computes cosine similarity in JavaScript, and returns the top-K results.

| Parameter       | Value   | Description                                      |
|----------------|---------|--------------------------------------------------|
| similarity     | 0.5     | Minimum cosine similarity threshold               |
| limit          | 5       | Maximum number of results returned                |

### RRF Merging

Both result lists are passed to `mergeWithRRF()`, which fuses them using weighted Reciprocal Rank Fusion:

1. All unique chunk IDs from both lists are collected
2. Each chunk gets a rank in each list (1-indexed); chunks missing from a list receive a penalty rank of `listLength + 1`
3. Fused score: `bm25Weight * 1/(K + rank_bm25) + vectorWeight * 1/(K + rank_vector)` (K defaults to 60)
4. Results are deduplicated by chunk ID, sorted by fused score descending, and limited to 5

### Fallback Behavior

- If vector search fails → BM25 results only (warning logged)
- If BM25 search fails → vector results only (warning logged)
- If both fail → empty result array, LLM proceeds without additional context

### Legacy Backend (Orama via SettingsStorageProvider)

When using the `settings` backend, search goes through Orama's in-memory vector index with a 0.65 similarity threshold. The legacy path uses `rerankWithRRF()` (single-list reranking) and is not affected by the hybrid search pipeline.

### What Gets Returned

Each search hit contains:
- `id` — the document/chunk identifier
- `content` — the full chunk text that was embedded
- `score` — original similarity or BM25 score
- `rrfScore` — fused RRF score used for final ranking

### Reranking

For the hybrid search path (SQLiteVectorStore), results are merged and ranked by `mergeWithRRF()`, which performs dual-list RRF fusion with classification-based weights. The legacy Orama path continues to use `rerankWithRRF()` for single-list reranking that combines vector similarity rank with keyword match rank.

### No Results Scenario

If no documents meet the similarity threshold and BM25 returns no matches, the results array is empty and no additional context is added to the prompt. The LLM still receives the system prompt, conversation history, and current page context.

## Step 3: Prompt Construction

The LLM prompt is assembled in this order:

```
{settings.prompt}                          ← System prompt from settings

Conversation History:                      ← Last 6 messages (if any)
User: {message 1}
Assistant: {response 1}
User: {message 2}
...

Current Page Context:                      ← Currently open page (if available)
current_page_open_id: {page.id}
current_page_open_name: {page.name}
current_page_open_content: {block contents}

Additional Context from Knowledge Base:    ← Retrieved documents (if any)
{hit 1 full page content}

{hit 2 full page content}

{hit 3 full page content}
...
```

### Prompt Components

| Component              | Source                          | Max Size              | Optional |
|-----------------------|--------------------------------|-----------------------|----------|
| System prompt         | `settings.prompt`              | User-defined          | No       |
| Conversation history  | In-memory array                | Last 6 messages       | Yes      |
| Current page context  | `logseq.Editor.getCurrentPage()` | Full page content   | Yes      |
| Retrieved documents   | Vector search results          | Up to 5 full pages    | Yes      |

### Conversation History

- Stored in an in-memory array (not persisted across plugin reloads)
- Limited to the most recent 6 messages (configurable via `MAX_HISTORY_LENGTH`)
- When the array exceeds 12 entries (2x max), older entries are trimmed
- Each entry has a role (`user` or `assistant`) and content

### Current Page Context

- Fetched via `logseq.Editor.getCurrentPage()` at query time
- If the user has a page open, its block tree is extracted and included
- If no page is open or fetching fails, this section is silently omitted

### Retrieved Documents

- Each hit's `document.content` is appended as-is (the full page text that was embedded)
- Documents are separated by double newlines
- No deduplication — if the current page also appears in search results, its content appears twice in the prompt

## Step 4: LLM Query

The assembled prompt is sent to the LLM via LiteLLM.

- **Endpoint**: Configurable via `settings.LiteLLMLink` (default: public LiteLLM instance)
- **Model**: Configurable via `settings.selectedModel` (default: `gpt-3.5-turbo`)
- **Auth**: The `settings.apiKey` is passed both as a Bearer token and in the request body
- **Message format**: Single user message containing the full assembled prompt
- **No streaming**: The response is awaited in full before displaying
- **Cancellable**: The user can click the stop button to abort the LLM request mid-flight via `AbortController`

The assistant's response is added to the conversation history for future context.

## Fallback Behavior

The retrieval pipeline is wrapped in a try/catch. If any step fails (embedding, search, or database load), the query still proceeds:

- `vectorContext` is set to an empty string
- The LLM receives only the system prompt, conversation history, and current page context
- The error is logged to console but not shown to the user

This means the plugin always works — even without embeddings configured — by falling back to the currently active note as context.

## Limitations

- **Full chunk injection**: Retrieved chunks are injected in full, which can consume significant prompt tokens for long pages.
- **No deduplication**: The current page may appear both as "Current Page Context" and in "Additional Context" if it's a top search result.
- **Fixed parameters**: Similarity threshold (0.5) and result limit (5) are hardcoded, not configurable via settings.
- **Single-turn LLM call**: The full prompt is sent as one user message. No system/user message separation or multi-turn chat API usage.
- **No timeout on LLM call**: The `queryLiteLLM()` fetch has no built-in timeout, but the user can cancel it via the stop button in the chat UI.
- **Brute-force search**: The SQLite backend scans all document embeddings for every query. This is fast for typical graph sizes but scales linearly with document count.

## File Reference

| File                     | Responsibility                                          |
|-------------------------|---------------------------------------------------------|
| `src/manager.ts`        | `handleQuery()` — orchestrates the full retrieval pipeline |
| `src/embedManager.ts`   | `useGenerateEmbedding()` — embeds the query text         |
| `src/storage/SQLiteVectorStore.ts` | `searchByVector()` — brute-force cosine similarity search (default backend) |
| `src/storage/cosineSimilarity.ts` | `cosineSimilarity()` — cosine similarity computation     |
| `src/bm25Index.ts`      | `BM25Index` — in-memory inverted index for BM25 keyword search |
| `src/queryClassifier.ts`| `classifyQuery()` — heuristic query classification (keyword/semantic/mixed) |
| `src/hybridSearch.ts`   | `hybridSearch()` — hybrid search pipeline orchestration   |
| `src/reranker.ts`       | `rerankWithRRF()` — single-list RRF reranking (legacy Orama path); `mergeWithRRF()` — dual-list RRF fusion (hybrid search) |
| `src/VectorDBManager.ts`| `vectorSearchOramaDB()` — legacy Orama vector search (settings backend only) |
| `src/LLMManager.ts`     | `queryLiteLLM()` — sends prompt to LLM via LiteLLM      |
| `src/settings.ts`       | Plugin settings (model, API keys, prompt, endpoint, storage backend) |
