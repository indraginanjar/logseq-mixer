# Retrieval Pipeline

End-to-end documentation of Logseq Mixer's hybrid RAG system — from embedding generation through chunking, indexing, hybrid search, and prompt assembly.

---

## Pipeline Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      INDEXING PIPELINE                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Page → flattenBlocks() → resolveBlockReferences()              │
│       → identifySemanticGroups() → buildSubtreeChunks()         │
│       → useGenerateEmbedding() → SQLiteVectorStore.upsert()     │
│       → VectorSearchAccelerator.add() + BM25Index.add()         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                      QUERY PIPELINE                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Query → classifyQuery() → [keyword|mixed|semantic]             │
│        → useGenerateEmbedding(query)                            │
│        ├→ BM25Index.search() ──────────────┐                    │
│        └→ VectorSearchAccelerator.search() ─┤                   │
│                                             ↓                   │
│                                    mergeWithRRF()               │
│                                             ↓                   │
│                              Top 5 fused chunks                 │
│                                             ↓                   │
│                         Build LLM prompt + query LLM            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Embedding Providers

The plugin supports two embedding providers, configurable via `embeddingProvider`:

| Provider | Auth | Default Endpoint | Request Format |
|---|---|---|---|
| **OpenAI** (default) | Bearer token | `https://api.openai.com/v1/embeddings` | `{ model, input: text }` |
| **Ollama** | None | `http://localhost:11434/api/embeddings` | `{ model, prompt: text }` |

### Supported Models

| Model | Provider | Dimensions | Max Tokens | Cost |
|---|---|---|---|---|
| `text-embedding-3-small` (default) | OpenAI | 1536 | 8,191 | ~$0.02/1M tokens |
| `text-embedding-ada-002` | OpenAI | 1536 | 8,191 | ~$0.10/1M tokens |
| `text-embedding-3-large` | OpenAI | 3072 | 8,191 | ~$0.13/1M tokens |
| `nomic-embed-text` | Ollama | 768 | 8,192 | Free (local) |
| `mxbai-embed-large` | Ollama | 1024 | 512 | Free (local) |
| `all-minilm` | Ollama | 384 | 256 | Free (local) |

### Model Change Behavior

When the embedding model is changed in settings:
1. Plugin compares current `embeddingModel` against persisted `lastEmbeddingModel`
2. If different → fresh database created with new dimensions
3. All existing embeddings are discarded (models produce incompatible vector spaces)
4. User must re-index

---

## Indexing

### Triggers

| Trigger | Mode | Concurrency |
|---|---|---|
| **Manual Re-Index** button | `indexingMode` setting (incremental/full) | Sequential |
| **Auto-indexing** (page edit) | Always incremental | Sequential, 300s debounce |
| **Query-time** | Single query embedding | Single API call |

### Incremental Indexing (Default)

1. **Garbage collection:** Compare indexed page IDs against `getAllPages()`, purge stale entries from deleted pages
2. Load existing database
3. Iterate all pages, compare `updatedAt` vs stored `lastUpdated`
4. Skip unchanged pages
5. For changed pages: delete old chunks, generate new embeddings, insert
6. Skip internal pages: cards, contents, favorites, `__*` prefixed, journals index

### Garbage Collection (Automatic)

Runs at the start of every incremental indexing run (both manual Re-Index and auto-indexing). Detects and removes index entries for pages that no longer exist in the graph.

**Algorithm:**
1. Query distinct page IDs from the `documents` table (stripping `_chunk_N` suffixes)
2. Get all currently existing page IDs from `logseq.Editor.getAllPages()`
3. Compute the set difference (indexed but no longer existing = stale)
4. For each stale page:
   - Delete all document chunks (`{pageId}` and `{pageId}_chunk_*`)
   - Remove vectors from HNSW accelerator
   - Remove entries from BM25 inverted index
   - Delete associated `block_metadata` rows (by page name extracted from chunk content)

**Performance:** ~200–500ms for a 100MB database. All operations are on the in-memory SQLite instance — no embedding API calls required.

**Why this matters:** Without GC, deleted pages leave orphaned chunks in the index. These produce stale `((uuid))` block references in RAG results that point to blocks that no longer exist.

### Full Indexing

1. Create fresh empty database
2. Process every page in the graph
3. Batch: 5 pages concurrently
4. Clear block reference cache

### Stop & Cooldown

- User can click "Stop" during indexing — already-processed pages are preserved
- After stop: 60-second cooldown (Re-Index disabled, auto-indexer suppressed)
- Normal completion: no cooldown, button immediately re-enables

---

## Chunking Algorithm

### Hierarchy-Aware Subtree Chunking

The chunker respects Logseq's parent-child block structure rather than splitting on arbitrary token boundaries.

#### Processing Pipeline

```
1. Fetch block tree          → logseq.Editor.getPageBlocksTree()
2. Flatten hierarchy         → flattenBlocks() — recursive with breadcrumbs
3. Resolve references        → resolveBlockReferences() — ((uuid)) → actual text
4. Identify semantic groups  → identifySemanticGroups() — headings + children
5. Compute token lengths     → countTokens() per block line
6. Subtree chunking          → buildSubtreeChunks() — token-budget-aware
7. Prepend page header       → note_id, note_name, tags, links, backlinks
8. Prepend ancestor context  → Parent breadcrumbs for nested chunk starts
9. Apply overlap             → Carry-over blocks between adjacent chunks
10. Store block metadata     → UUID → pageName + contentPreview (for citations)
```

#### Block Flattening

```
Top-level block A
  Child block A.1
    Grandchild block A.1.1
  Child block A.2

→ Flattened:
[block:uuid-a] - Block A content
[block:uuid-a1] [Block A content…] Block A.1 content
[block:uuid-a11] [Block A content… > Block A.1 content…] Block A.1.1 content
[block:uuid-a2] [Block A content…] Block A.2 content
```

Each block is annotated with `[block:<uuid>]` for LLM citation.

#### Block Reference Resolution

| Pattern | Resolution |
|---|---|
| `((uuid))` | Replaced with referenced block's text |
| `{{embed ((uuid))}}` | Replaced with embedded block's text |

Per-run cache prevents redundant `logseq.Editor.getBlock()` calls. Unresolvable references preserved as-is.

#### Subtree Chunking Rules

1. **Heading cohesion:** Headings and their children stay together if within budget
2. **Ancestor breadcrumbs:** Chunks starting at nested depth get parent context prepended (truncated to 60 chars/ancestor)
3. **Overlap:** Last 15% of previous chunk's blocks prepended to next chunk (capped at 20% of token budget)
4. **Single-block overflow:** Blocks exceeding the limit are split by raw token slices

#### Chunk IDs

| Scenario | Format |
|---|---|
| Single chunk (short page) | `{pageId}` |
| Multiple chunks (long page) | `{pageId}_chunk_{n}` |

#### Page Metadata Header

Every chunk is prefixed with:
```
note_id: {page.id}
note_name: {page.name}
note_tags: {tags}
note_links: {outgoing links}
note_backlinks: {backlinks}
note_content:
```

---

## Vector Storage

### SQLite Schema

```sql
-- Document embeddings
CREATE TABLE documents (
  id TEXT PRIMARY KEY,           -- pageId or pageId_chunk_n
  content TEXT,                  -- Full chunk text
  lastUpdated INTEGER,          -- Page timestamp
  embedding BLOB                -- Raw Float32Array (4 bytes/float)
);

-- Block citation metadata
CREATE TABLE block_metadata (
  uuid TEXT PRIMARY KEY,         -- Block UUID
  pageName TEXT,                -- Parent page name
  contentPreview TEXT           -- First 50 chars (truncated with "…")
);
```

### HNSW Acceleration

| Parameter | Value | Description |
|---|---|---|
| **M** | 16 | Bi-directional links per node |
| **efSearch** | 64 | Query-time search depth (≥95% recall vs exact) |
| **Threshold** | 0.5 | Minimum cosine similarity |
| **Limit** | 5 | Max results per search |

The HNSW index is:
- **Volatile** — lives only in memory, rebuilt from SQLite on each startup
- **Incrementally maintained** — add/remove/upsert keep it synchronized
- **Auto-rebuilt** when embedding dimension changes or tombstones exceed 20%
- **Transparent fallback** — if unavailable, brute-force cosine scan in SQLiteVectorStore

### IndexedDB Persistence

The entire sql.js database is serialized as a binary `ArrayBuffer` and stored in IndexedDB. On load:
1. Restore from IndexedDB (binary, no JSON parsing)
2. If corrupted → create fresh database
3. Build HNSW index from all stored embeddings

---

## Query Pipeline

### Step 1: Query Classification

`classifyQuery()` detects keyword indicators to weight BM25 vs. vector results:

**Indicators:** URLs, file paths, camelCase, snake_case, quoted phrases, regex patterns, special characters.

| Classification | Indicators | BM25 Weight | Vector Weight |
|---|---|---|---|
| `keyword` | ≥2 | 1.5 | 0.5 |
| `mixed` | 1 | 1.0 | 1.0 |
| `semantic` | 0 | 0.5 | 1.5 |

### Step 2: BM25 Keyword Search

In-memory inverted index built from all document content at startup.
- Tokenization: split on whitespace/punctuation, lowercased
- Scoring: Okapi BM25 (k1=1.2, b=0.75)
- Limit: top 5 results

### Step 3: Vector Similarity Search

Query is embedded, then searched against the HNSW index:
- Similarity threshold: 0.5 (minimum cosine similarity)
- Result limit: 5
- Fallback: brute-force scan if HNSW unavailable

### Step 4: RRF Fusion

`mergeWithRRF()` combines both result lists:

```
fused_score = bm25Weight × 1/(K + rank_bm25) + vectorWeight × 1/(K + rank_vector)
```

- K = 60 (constant)
- Missing entries get penalty rank = `listLength + 1`
- Deduplicated by chunk ID
- Sorted by fused score descending
- Limited to 5 results

### Fallback Chain

```
HNSW unavailable → brute-force cosine scan
Vector search fails → BM25 results only
BM25 fails → vector results only
Both fail → empty context (LLM proceeds with page context only)
```

---

## Prompt Construction

The LLM prompt is assembled in message order:

```
┌─ System Message ─────────────────────────────────┐
│ {settings.prompt}                                │
│ (formatting rules, citation instructions)        │
└──────────────────────────────────────────────────┘

┌─ User Message ───────────────────────────────────┐
│ Conversation History: (last 6 messages)          │
│                                                  │
│ Current Page Context:                            │
│   current_page_open_id: ...                      │
│   current_page_open_name: ...                    │
│   current_page_open_content: [block tree]        │
│                                                  │
│ Additional Context from Knowledge Base:          │
│   [hit 1 full content with [block:uuid] annot.]  │
│   [hit 2 ...]                                    │
│   [hit 3 ...]                                    │
│                                                  │
│ {user query}                                     │
└──────────────────────────────────────────────────┘
```

### Conversation History

- In-memory array (not persisted across reloads)
- Limited to last 6 messages
- Trimmed at 12 entries (2x max)

### Model-Specific Output Limits

| Model | Max Output Tokens |
|---|---|
| GPT-5 | 128,000 |
| o3/o3-mini | 100,000 |
| o1/o1-mini | 65,536 |
| o4-mini | 65,536 |
| GPT-4o | 16,384 |
| GPT-4 | 8,192 |
| GPT-3.5-turbo | 4,096 |
| Unknown models | 4,096 (fallback) |

> **Note:** For reasoning models (o-series, GPT-5+), `max_completion_tokens` is used instead of `max_tokens`. If a model rejects `max_tokens`, the request auto-retries with `max_completion_tokens` and the model is remembered for the session.

---

## Direct Page Edit Mode

When the ✏️ toggle is enabled:

1. **Context:** Active page's block tree fetched and formatted with UUIDs
2. **Prompt supplement:** `buildEditSystemPrompt()` instructs LLM to emit structured commands in ` ```json-edit ` blocks
3. **Parsing:** `parseEditCommands()` extracts and validates commands
4. **Execution:** `executeAll()` runs commands sequentially via Logseq API
5. **Summary:** `ChangeSummary` component displays results

### Edit Command Schema

```typescript
interface EditCommand {
  action: "insert" | "update" | "delete";
  blockUUID?: string;       // Required for update, delete
  parentBlockUUID?: string; // Required for insert
  content?: string;         // Required for insert, update
  siblingOrder?: number;    // Optional position (0 = first child)
}
```

### Safety

- No page open → edit mode silently disabled with warning
- Invalid commands (malformed JSON, missing fields) → skipped
- Each command in try/catch → one failure doesn't block others
- `redirect: false` on page creation → no navigation hijack

---

## Response Rendering

LLM responses containing Logseq notation are transformed:

1. `[[page name]]` → `[page name](logseq://page/page-name)` → `PageLink` component (blue, navigates)
2. `((uuid))` → `[((uuid))](logseq://block/uuid)` → `BlockLink` component (teal, navigates)
3. `BlockLink` looks up `block_metadata` table for label (page name + preview)
4. Click → `logseq.Editor.scrollToBlockInPage()` navigates to source

---

## Error Handling

| Failure | Behavior |
|---|---|
| Embedding API timeout (30s) | Request aborted, descriptive error |
| Embedding API error | Error message surfaced with HTTP status |
| Ollama unreachable | "Ollama embedding endpoint is not reachable at {endpoint}" |
| Missing OpenAI key | Error thrown before request |
| Malformed embedding response | "Unexpected embedding response format" |
| HNSW WASM load failure | Transparent fallback to brute-force |
| Database corruption | Fresh database created automatically |
| Per-page embedding failure | Error logged, indexing continues |
| Reference resolution failure | Original `((uuid))` syntax preserved |
| Entire retrieval pipeline failure | LLM proceeds without RAG context |

---

## Limitations

- **Full chunk injection:** Retrieved chunks injected in full — consumes significant prompt tokens for long pages
- **No deduplication:** Current page may appear in both "Current Page Context" and "Additional Context"
- **Fixed parameters:** Similarity threshold (0.5) and result limit (5) are hardcoded
- **No streaming:** Responses awaited in full before display
- **Single-level reference resolution:** Nested references within references not recursively resolved
- **Brute-force scaling:** Without HNSW, search scales linearly with document count
- **Token limit truncation:** Model output limits are hardcoded per model

---

## File Reference

| File | Responsibility |
|---|---|
| `src/embedManager.ts` | Block flattening, reference resolution, chunking orchestration, embedding generation |
| `src/hierarchyChunker.ts` | `buildSubtreeChunks()`, `buildAncestorContext()`, depth weighting |
| `src/indexManager.ts` | Incremental indexing, auto-index, re-index guard, garbage collection of deleted pages |
| `src/storage/SQLiteVectorStore.ts` | Document CRUD, cosine search (fallback), block metadata, IndexedDB persistence |
| `src/storage/VectorSearchAccelerator.ts` | HNSW index wrapper with auto-fallback |
| `src/storage/cosineSimilarity.ts` | Embedding BLOB encode/decode, cosine computation |
| `src/bm25Index.ts` | In-memory BM25 inverted index |
| `src/queryClassifier.ts` | Heuristic query classification |
| `src/hybridSearch.ts` | Hybrid search pipeline orchestration |
| `src/reranker.ts` | `mergeWithRRF()` (dual-list) and `rerankWithRRF()` (legacy single-list) |
| `src/LLMManager.ts` | LLM communication (OpenAI, Ollama, LiteLLM), model token limits, dynamic model discovery, max_tokens parameter negotiation |
| `src/manager.ts` | `handleQuery()` — full pipeline orchestration |
| `src/editPromptBuilder.ts` | Direct Page Edit system prompt and page context |
| `src/editCommandParser.ts` | Extract/validate edit commands from json-edit blocks |
| `src/blockExecutor.ts` | Execute edit commands via Logseq API |
| `src/blockTreeFormatter.ts` | Format page block trees with UUIDs |
| `src/blockRefParser.ts` | `((uuid))` → clickable link transformation |
| `src/tokenizer.ts` | Lazy cl100k_base tokenizer (dynamic import) |
| `src/cooldownManager.ts` | Re-index cooldown logic |
| `src/settings.ts` | All plugin settings including embedding config |

---

## Related Documentation

- [Architecture](https://github.com/indraginanjar/logseq-mixer/blob/main/docs/technical/architecture.md) — System overview and module map
- [Agent Internals](https://github.com/indraginanjar/logseq-mixer/blob/main/docs/technical/agent-internals.md) — How the agent uses retrieval results
- [Getting Started](https://github.com/indraginanjar/logseq-mixer/blob/main/docs/user/getting-started.md) — User-facing setup guide
