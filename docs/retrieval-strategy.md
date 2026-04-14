# Retrieval Strategy

## Overview

Logseq Composer uses Retrieval-Augmented Generation (RAG) to provide the LLM with relevant context from the user's notes. When a user sends a query, the plugin retrieves semantically similar pages from the vector database and injects their content into the LLM prompt alongside conversation history and the currently open page.

## Retrieval Pipeline

```
User Query
    │
    ▼
┌──────────────────────────┐
│ 1. Embed the query       │  useGenerateEmbedding(query)
│    (selected model)      │
└────────────┬─────────────┘
             │
             ▼
┌──────────────────────────┐
│ 2. Vector similarity     │  storageProvider.searchByVector()
│    search (brute-force   │
│    cosine similarity)    │
│    - threshold: 0.5      │
│    - top 5 results       │
└────────────┬─────────────┘
             │
             ▼
┌──────────────────────────┐
│ 3. Rerank with RRF       │  rerankWithRRF(hits, query)
└────────────┬─────────────┘
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

## Step 1: Query Embedding

The user's query text is embedded using the same model and API key used for indexing. The model is configurable (default: `text-embedding-3-small`), producing a 1536 or 3072-dimensional vector depending on the selected model.

- Same truncation rules apply (24,000 char limit), though queries are typically short
- Same 30-second timeout applies
- If embedding fails, vector search is skipped entirely and the query proceeds with only the current page as context

## Step 2: Vector Search

The query vector is searched against the stored documents using brute-force cosine similarity.

### Default Backend (SQLiteVectorStore)

The `SQLiteVectorStore` reads all rows from the `documents` table, decodes each embedding BLOB to a `Float32Array`, computes cosine similarity in JavaScript, and returns the top-K results.

| Parameter       | Value   | Description                                      |
|----------------|---------|--------------------------------------------------|
| similarity     | 0.5     | Minimum cosine similarity threshold               |
| limit          | 5       | Maximum number of results returned                |

### Legacy Backend (Orama via SettingsStorageProvider)

When using the `settings` backend, search goes through Orama's in-memory vector index with a 0.65 similarity threshold.

### What Gets Returned

Each search hit contains:
- `id` — the document/chunk identifier
- `content` — the full chunk text that was embedded
- `score` — cosine similarity score

### Reranking

After vector search, results are reranked using Reciprocal Rank Fusion (RRF) via `rerankWithRRF()`. This combines the vector similarity score with keyword-based scoring for improved relevance.

### No Results Scenario

If no documents meet the similarity threshold, the results array is empty and no additional context is added to the prompt. The LLM still receives the system prompt, conversation history, and current page context.

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

The assistant's response is added to the conversation history for future context.

## Fallback Behavior

The retrieval pipeline is wrapped in a try/catch. If any step fails (embedding, search, or database load), the query still proceeds:

- `vectorContext` is set to an empty string
- The LLM receives only the system prompt, conversation history, and current page context
- The error is logged to console but not shown to the user

This means the plugin always works — even without embeddings configured — by falling back to the currently active note as context.

## Limitations

- **No hybrid search**: Only vector similarity is used (with RRF reranking for keyword boosting). No BM25 scoring.
- **Full chunk injection**: Retrieved chunks are injected in full, which can consume significant prompt tokens for long pages.
- **No deduplication**: The current page may appear both as "Current Page Context" and in "Additional Context" if it's a top search result.
- **Fixed parameters**: Similarity threshold (0.5) and result limit (5) are hardcoded, not configurable via settings.
- **Single-turn LLM call**: The full prompt is sent as one user message. No system/user message separation or multi-turn chat API usage.
- **No timeout on LLM call**: The `queryLiteLLM()` fetch has no `AbortController` timeout (unlike the embedding call).
- **Brute-force search**: The SQLite backend scans all document embeddings for every query. This is fast for typical graph sizes but scales linearly with document count.

## File Reference

| File                     | Responsibility                                          |
|-------------------------|---------------------------------------------------------|
| `src/manager.ts`        | `handleQuery()` — orchestrates the full retrieval pipeline |
| `src/embedManager.ts`   | `useGenerateEmbedding()` — embeds the query text         |
| `src/storage/SQLiteVectorStore.ts` | `searchByVector()` — brute-force cosine similarity search (default backend) |
| `src/storage/cosineSimilarity.ts` | `cosineSimilarity()` — cosine similarity computation     |
| `src/reranker.ts`       | `rerankWithRRF()` — Reciprocal Rank Fusion reranking     |
| `src/VectorDBManager.ts`| `vectorSearchOramaDB()` — legacy Orama vector search (settings backend only) |
| `src/LLMManager.ts`     | `queryLiteLLM()` — sends prompt to LLM via LiteLLM      |
| `src/settings.ts`       | Plugin settings (model, API keys, prompt, endpoint, storage backend) |
