# Bugfix Requirements Document

## Introduction

The logseq-composer plugin causes Logseq to hang and become unresponsive when the auto-indexer is enabled. The root cause is a combination of feedback loops, API flooding, missing debounce, heavy serialization on every change, and sequential blocking embedding calls triggered by `logseq.DB.onChanged`. System resources are not exhausted (CPU ~60%, memory ~49%), confirming this is a software-level issue — not resource starvation. The hang renders Logseq unusable and requires a force-quit.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN `batchInsertEmbeddings()` calls `logseq.updateSettings()` to persist the vector DB THEN the system triggers `logseq.DB.onChanged`, which re-invokes `checkAndIndexUpdatedPages()`, creating a feedback loop that compounds indexing work despite the `indexingInProgress` guard and `setIsUpdatingSettings` flag having race condition windows

1.2 WHEN `logseq.DB.onChanged` fires (on every keystroke or DB mutation) THEN the system immediately calls `checkAndIndexUpdatedPages()` with no debounce, causing rapid-fire indexing attempts that pile up after the 1-second cooldown expires

1.3 WHEN `checkAndIndexUpdatedPages()` runs for each `onChanged` event THEN the system calls `logseq.Editor.getAllPages()`, then for each outdated page calls `getPageBlocksTree()`, `fetchBacklinks()` → `getPageLinkedReferences()`, and `resolveBlockReferences()` → `getBlock()` per block reference, flooding Logseq's IPC channel and blocking the UI thread

1.4 WHEN `batchInsertEmbeddings()` completes for any page update THEN the system serializes the entire Orama vector DB via `persist(oramaDBInstance, 'json')` and writes the full JSON to Logseq settings via `logseq.updateSettings()`, which for large graphs produces megabytes of JSON on every single page change

1.5 WHEN `getEmbeddingsForPage()` processes a page with multiple chunks THEN the system calls the OpenAI embedding API sequentially for each chunk with a 30-second timeout per call, blocking the `onChanged` handler for potentially minutes if the API is slow

### Expected Behavior (Correct)

2.1 WHEN `batchInsertEmbeddings()` persists the vector DB to Logseq settings THEN the system SHALL prevent the resulting `onChanged` event from re-triggering `checkAndIndexUpdatedPages()`, eliminating the feedback loop with a reliable guard that has no race condition window

2.2 WHEN `logseq.DB.onChanged` fires rapidly (e.g., during typing) THEN the system SHALL debounce the indexing trigger so that `checkAndIndexUpdatedPages()` is invoked at most once per a reasonable quiet period (e.g., 3–5 seconds of inactivity), preventing rapid-fire indexing attempts

2.3 WHEN `checkAndIndexUpdatedPages()` runs THEN the system SHALL limit the number of concurrent Logseq API calls (e.g., batch or throttle `getPageBlocksTree`, `getPageLinkedReferences`, and `getBlock` calls) to avoid flooding Logseq's IPC channel and blocking the UI

2.4 WHEN the vector DB is updated after indexing pages THEN the system SHALL avoid serializing and persisting the entire database on every single page change, instead deferring persistence (e.g., batching writes or persisting only after a quiet period) to reduce the serialization overhead

2.5 WHEN `getEmbeddingsForPage()` processes multiple chunks THEN the system SHALL use concurrent (parallel) embedding API calls with reasonable concurrency limits and shorter timeouts, so that a single slow API response does not block the entire `onChanged` handler for minutes

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a page is edited and the auto-indexer is enabled THEN the system SHALL CONTINUE TO eventually index the updated page and persist its embeddings to the vector DB

3.2 WHEN a full re-index is triggered via `indexEntireLogSeq()` THEN the system SHALL CONTINUE TO index all pages and produce correct embeddings stored in the vector DB

3.3 WHEN a user submits a query via `handleQuery()` THEN the system SHALL CONTINUE TO load the vector DB, generate a query embedding, perform vector search, rerank results, and return an LLM response with relevant context

3.4 WHEN the embedding model is changed in settings THEN the system SHALL CONTINUE TO detect the model change and force a fresh database creation with the correct dimensions

3.5 WHEN block references `((uuid))` or embeds `{{embed ((uuid))}}` appear in page content THEN the system SHALL CONTINUE TO resolve them to actual block content during the embedding pipeline

3.6 WHEN the plugin is first enabled or settings are loaded THEN the system SHALL CONTINUE TO restore the vector DB from persisted settings JSON without data loss
