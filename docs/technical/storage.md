# Storage & Database Architecture

Complete reference for all data storage mechanisms used by Logseq Mixer — database schema, persistence layers, and data lifecycle.

---

## Overview

Logseq Mixer uses a layered storage architecture:

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser Runtime                           │
├────────────────────┬──────────────────┬─────────────────────────┤
│   SQLite (sql.js)  │   HNSW Index     │   BM25 Index            │
│   - documents      │   (volatile)     │   (volatile)            │
│   - block_metadata │                  │                         │
│   - agent_memory   │                  │                         │
│   - kv_store       │                  │                         │
├────────────────────┼──────────────────┼─────────────────────────┤
│    IndexedDB       │     (memory)     │     (memory)            │
│    (persistent)    │  rebuilt on load  │  rebuilt on first query │
├────────────────────┴──────────────────┴─────────────────────────┤
│                       localStorage                               │
│   - input history (logseq-mixer-input-history)                  │
│   - MCP tool states (logseq-mixer:mcp-tools)                    │
│   - panel width (logseq-mixer-panel-width)                      │
│   - provider models (logseq-mixer-provider-models)              │
├─────────────────────────────────────────────────────────────────┤
│                    Logseq Plugin Settings                         │
│   - LLM config, embedding config, agent settings                │
├─────────────────────────────────────────────────────────────────┤
│                       Logseq Graph                               │
│   - Mixer/Memory/* pages (long-term memory for RAG)             │
└─────────────────────────────────────────────────────────────────┘
```

---

## SQLite Database (Primary Storage)

### Technology

- **Engine:** [sql.js](https://github.com/sql-js/sql.js) (SQLite compiled to WebAssembly)
- **Persistence:** Entire database serialized as a binary `ArrayBuffer` and stored in IndexedDB
- **Location:** IndexedDB database `logseq-mixer-vectors`, object store `sqlite`, key `vectors:{graphPath}`
- **Graph isolation:** Each Logseq graph gets its own database identified by the graph's file path

### Initialization Sequence

```
1. Load sql.js WASM binary
2. Try to restore existing ArrayBuffer from IndexedDB
3. If found → open as SQLite database
4. If not found or corrupted → create fresh database
5. Run CREATE TABLE IF NOT EXISTS for all tables
6. Check for legacy Orama data → migrate if found
```

### Schema

#### `documents` — Vector Embeddings & Chunks

Stores chunked page content with their vector embeddings for semantic search.

```sql
CREATE TABLE IF NOT EXISTS documents (
  id          TEXT PRIMARY KEY,    -- pageId or pageId_chunk_N
  content     TEXT NOT NULL,       -- chunk text with ancestor context
  lastUpdated INTEGER NOT NULL,    -- page updatedAt timestamp
  embedding   BLOB NOT NULL,       -- Float32Array as raw bytes (4 bytes × dimensions)
  root_depth  INTEGER NOT NULL DEFAULT 0,  -- depth of root block in chunk (0 = top-level)
  has_heading INTEGER NOT NULL DEFAULT 0   -- 1 if chunk starts with a heading block
);
```

**ID format:**
- Single-chunk pages: `"{pageId}"` (Logseq's numeric page ID as string)
- Multi-chunk pages: `"{pageId}_chunk_0"`, `"{pageId}_chunk_1"`, etc.

**Embedding encoding:**
- Stored as raw `Float32Array` bytes (little-endian)
- Dimensions depend on model: 1536 (text-embedding-3-small), 3072 (text-embedding-3-large), 768 (nomic-embed-text), etc.
- Byte length = dimensions × 4

**Excluded from indexing:**
- Internal pages: `card*`, `contents`, `favorites`, `__*`, `journals`
- Plugin pages: `Mixer/*` (memory session summaries)

#### `block_metadata` — UUID-to-Page Mapping

Maps block UUIDs to their page name and content preview for rendering clickable `((block-ref))` links.

```sql
CREATE TABLE IF NOT EXISTS block_metadata (
  uuid           TEXT PRIMARY KEY,   -- block UUID from Logseq
  pageName       TEXT NOT NULL,      -- name of the page containing this block
  contentPreview TEXT NOT NULL       -- first ~100 chars of block content
);
```

#### `agent_memory` — AI Memory Store

Stores structured memories for the AI agent (preferences, facts, session summaries, task outcomes).

```sql
CREATE TABLE IF NOT EXISTS agent_memory (
  id            TEXT PRIMARY KEY,    -- UUID (crypto.randomUUID)
  category      TEXT NOT NULL,       -- 'preference' | 'fact' | 'session_summary' | 'task_outcome'
  content       TEXT NOT NULL,       -- the memory content
  created_at    INTEGER NOT NULL,    -- Date.now() timestamp
  last_accessed INTEGER,             -- updated when memory is injected into a prompt
  source        TEXT,                -- 'explicit' | 'auto' | 'rag' | null
  metadata      TEXT                 -- optional JSON metadata
);
```

**Memory categories:**
| Category | Source | Purpose |
|---|---|---|
| `preference` | User says "remember that I prefer..." | Injected into every prompt |
| `fact` | User states factual info to remember | Injected when keyword-matched |
| `session_summary` | Auto-generated on new session | Last 3 summaries injected |
| `task_outcome` | Auto-saved after agent completes a goal | Retrieved via keyword match |

#### `kv_store` — Key-Value Metadata

General-purpose key-value store for plugin metadata.

```sql
CREATE TABLE IF NOT EXISTS kv_store (
  key   TEXT PRIMARY KEY,
  value TEXT
);
```

**Known keys:**
| Key | Value | Purpose |
|---|---|---|
| `chunking_version` | `"2"` | Current chunking algorithm version (triggers full re-index on mismatch) |
| `orama_db` | (legacy JSON) | Legacy Orama database blob (migrated and removed on first run) |

---

## IndexedDB Persistence

The entire SQLite database exists only in memory (WebAssembly heap). To survive page reloads, the database is periodically serialized and written to IndexedDB.

### Structure

| Database | Object Store | Key | Value |
|---|---|---|---|
| `logseq-mixer-vectors` | `sqlite` | `vectors:{graphPath}` | `ArrayBuffer` (entire SQLite binary) |

### Flush Strategy

- **After indexing:** Flushed after each batch of pages and at completion
- **After bulk operations:** After upsert/delete operations (unless in bulk mode)
- **Retry on failure:** One automatic retry if the first flush fails
- **Bulk mode:** During re-indexing, flushes are deferred until `endBulk()` is called

### Size Characteristics

| Graph Size | Approximate DB Size |
|---|---|
| 100 pages | 2-5 MB |
| 500 pages | 10-25 MB |
| 2000 pages | 40-100 MB |

Size depends on embedding dimensions and average page length. The `text-embedding-3-small` model (1536 dimensions) uses ~6 KB per chunk for the embedding alone.

---

## In-Memory Indexes (Volatile)

These indexes are rebuilt from the SQLite database on every startup or plugin reload. They are never persisted directly.

### HNSW Vector Index

- **Library:** [hnswlib-wasm](https://github.com/nicolo-ribaudo/hnswlib-wasm)
- **Purpose:** Fast approximate nearest-neighbor search (sub-5ms at 20k+ chunks)
- **Rebuilt:** On plugin initialization, after SQLite is loaded
- **Fallback:** If HNSW fails or isn't ready, falls back to brute-force cosine similarity scan over all embeddings in SQLite

**Parameters:**
| Parameter | Value |
|---|---|
| Space | Cosine similarity |
| Max elements | Dynamic (number of documents) |
| EF construction | 200 |
| M | 16 |

### BM25 Inverted Index

- **Implementation:** Custom in-memory inverted index (`src/bm25Index.ts`)
- **Purpose:** Keyword/term matching for queries containing specific names, code, or quoted phrases
- **Rebuilt:** Lazily on first hybrid search query (from `getAllDocumentContent()`)
- **Updated:** Incrementally during auto-indexing (new chunks are upserted into existing index)

---

## localStorage (Browser Storage)

Small key-value data that doesn't warrant IndexedDB overhead.

### `logseq-mixer-input-history`

Persists the user's chat input history across sessions.

```json
["previous message 1", "previous message 2", "..."]
```

| Property | Value |
|---|---|
| **Type** | JSON array of strings |
| **Max entries** | 100 (oldest trimmed on overflow) |
| **Written** | After every submitted message |
| **Read** | On component mount (lazy `useState` initializer) |
| **Cleared** | Via the clear-history button (🗑️) in the input area |

### `logseq-mixer:mcp-tools`

Stores per-tool enable/disable state for MCP tools.

```json
{"server-name:tool-name": true, "server-name:other-tool": false}
```

| Property | Value |
|---|---|
| **Type** | JSON object mapping tool identifiers to booleans |
| **Written** | When user toggles a tool on/off in the MCP panel |
| **Read** | On MCPManager initialization |

### `logseq-mixer-panel-width`

Persists the chat panel width across sessions.

| Property | Value |
|---|---|
| **Type** | Number (320 to ~85% of viewport width) |
| **Written** | On resize mouseup (when user finishes dragging the panel edge) |
| **Read** | On component mount to restore the saved panel size |

### `logseq-mixer-provider-models`

Stores the last-selected model for each LLM provider, so switching providers restores the previous model choice.

```json
{"openai": "gpt-4o", "ollama": "llama3.2", "litellm": "claude-sonnet-4-20250514"}
```

| Property | Value |
|---|---|
| **Type** | JSON object mapping provider names to last-selected model |
| **Written** | On provider or model change |
| **Read** | On provider change (to restore the previous model selection for that provider) |

---

## Logseq Plugin Settings

Configuration values stored via Logseq's built-in plugin settings API (`logseq.settings`). These are managed by Logseq itself and persisted in the plugin's settings file.

| Category | Keys |
|---|---|
| **Chat LLM** | `selectedModel`, `apiKey`, `chatProvider`, `chatEndpoint` |
| **Embeddings** | `EmbeddingApiKey`, `embeddingModel`, `embeddingProvider`, `embeddingEndpoint` |
| **Auto-indexing** | `autoEmbedEnabled`, `autoIndexDebounceSeconds` |
| **Memory** | `memoryEnabled`, `autoSummarize`, `memoryBudgetPercent` |
| **Agent** | `agentMode`, `agentAutonomy`, `agentConfidenceThreshold`, `agentTokenBudget`, `agentMaxIterations`, `agentMaxRetries`, `agentVerboseMode`, `agentPersistVerboseToChat` |
| **MCP** | `mcpServers`, `mcpToolTimeout` |
| **System** | `prompt` (system prompt template) |

---

## Logseq Graph Pages (Memory)

The AI writes long-term memory summaries as pages in the user's graph under the `Mixer/Memory/` namespace.

### Page Naming

```
Mixer/Memory/Session-{YYYY}-{MM}-{DD}-{HHMM}
```

Example: `Mixer/Memory/Session-2026-07-13-1520`

### Content Structure

Each page contains a block-based summary of a conversation session, written by the session summarizer LLM call.

### Relationship to RAG

- Memory pages are **excluded from vector indexing** (the `Mixer/` prefix is filtered by `isInternalPage`)
- They are accessible via Logseq's page API if the agent explicitly reads them
- The `injectMemoryContext()` function in `manager.ts` checks vector search results for chunks containing "Mixer/Memory" and routes them to the memory section of the prompt

---

## Data Lifecycle

### On Plugin Load

```
1. SQLite restored from IndexedDB → all tables available
2. HNSW index rebuilt from documents.embedding column
3. BM25 index: deferred until first search query
4. localStorage read: input history, MCP tool states, panel width, provider models
5. Plugin settings read from Logseq
```

### On Re-Index (Full)

```
1. Clear all rows in documents + block_metadata tables
2. Reset HNSW and BM25 indexes
3. Iterate all Logseq pages (excluding internal + Mixer/*)
4. For each page: chunk → embed → upsert into documents
5. Flush SQLite to IndexedDB
6. Rebuild HNSW from fresh embeddings
```

### On Re-Index (Incremental)

```
1. Garbage Collection:
   a. Query DISTINCT page IDs from documents table
   b. Compare against logseq.Editor.getAllPages()
   c. Delete chunks, HNSW vectors, BM25 entries, and block_metadata
      for pages that no longer exist
2. Iterate all Logseq pages (excluding internal + Mixer/*)
3. Compare page.updatedAt vs stored lastUpdated — skip unchanged
4. For changed pages: delete old chunks → re-chunk → embed → upsert
5. Flush SQLite to IndexedDB every 5 pages (batch mode)
```

### On Clear Index

```
1. DELETE FROM documents
2. DELETE FROM block_metadata
3. VACUUM (reclaim space)
4. Flush to IndexedDB
5. HNSW and BM25 indexes reset
```

### On Clear Memory

```
1. DELETE FROM agent_memory (via MemoryStore.deleteAll())
2. Note: Mixer/Memory/* pages in the graph are NOT deleted
   (they must be manually removed from Logseq if desired)
```

### On Plugin Uninstall

IndexedDB data and localStorage keys remain in the browser unless manually cleared. Logseq graph pages (Mixer/Memory/*) persist in the graph.

---

## Migration: Legacy Orama → SQLite

For users upgrading from the original Orama-based storage:

1. On initialization, checks `kv_store` for key `orama_db`
2. If found, deserializes the JSON blob
3. Extracts documents and re-inserts them into the `documents` table
4. Removes the `orama_db` key after successful migration
5. Flushes to IndexedDB

This is a one-time automatic migration.

---

## Related Documentation

- [Architecture](https://github.com/indraginanjar/logseq-mixer/blob/main/docs/technical/architecture.md) — System overview and module map
- [Retrieval Pipeline](https://github.com/indraginanjar/logseq-mixer/blob/main/docs/technical/retrieval-pipeline.md) — How hybrid search uses the storage layer
- [User Guide](https://github.com/indraginanjar/logseq-mixer/blob/main/docs/user/user-guide.md) — Input history and UI features
