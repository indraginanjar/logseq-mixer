# Embedding Hang Fix — Bugfix Design

## Overview

Logseq hangs during embedding/vectorization due to a combination of unbounded sequential API calls, multiple missing `await` keywords on async operations, and a cascading re-indexing loop. The fix targets seven distinct code defects across four source files (`embedManager.ts`, `VectorDBManager.ts`, `indexManager.ts`, `manager.ts`) plus a duplicate function in `hooks/useGenerateEmbedding.ts`. The strategy is to add proper async/await handling, introduce batching with concurrency control and timeouts for API calls, and break the re-indexing feedback loop — all while preserving existing query, database restore, and error-reporting behavior.

## Glossary

- **Bug_Condition (C)**: The set of execution paths where missing `await`, unbounded sequential API calls, or self-triggered `onChanged` events cause hangs, data corruption, or infinite loops
- **Property (P)**: All async operations are properly awaited, API calls are batched with timeouts, and self-triggered DB change events are ignored
- **Preservation**: Existing LLM query flow, database load/restore, legitimate `onChanged` indexing, and error reporting behavior must remain unchanged
- **getEmbedingsAllNotes()**: Function in `src/embedManager.ts` that generates embeddings for all Logseq pages sequentially with no batching or timeout
- **batchInsertEmbeddings()**: Function in `src/VectorDBManager.ts` that inserts embeddings and persists the database, but does not await `insertMultiple()`
- **checkAndIndexUpdatedPages()**: Function in `src/indexManager.ts` that indexes changed pages on DB change events, but does not await `remove()` or `batchInsertEmbeddings()`
- **indexEntireLogSeq()**: Function in `src/manager.ts` that orchestrates full re-indexing but does not await `batchInsertEmbeddings()`
- **vectorSearchOramaDB()**: Function in `src/VectorDBManager.ts` that searches the vector DB but does not await `search()`
- **useGenerateEmbedding()**: Function in `src/embedManager.ts` (and duplicated in `src/hooks/useGenerateEmbedding.ts`) that calls the OpenAI embedding API with no timeout

## Bug Details

### Bug Condition

The bug manifests across multiple async code paths where Promises are not awaited, API calls have no timeout or concurrency control, and database settings updates trigger recursive indexing. The combination causes the application to hang, corrupt data, or enter infinite loops.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type AsyncOperationContext
  OUTPUT: boolean

  missingAwaitOnInsert := input.function == "batchInsertEmbeddings"
                          AND input.callsInsertMultiple
                          AND NOT input.awaitsInsertMultiple

  missingAwaitOnBatchInsert := input.function IN ["indexEntireLogSeq", "checkAndIndexUpdatedPages"]
                               AND input.callsBatchInsertEmbeddings
                               AND NOT input.awaitsBatchInsertEmbeddings

  missingAwaitOnRemove := input.function == "checkAndIndexUpdatedPages"
                          AND input.callsRemove
                          AND NOT input.awaitsRemove

  missingAwaitOnSearch := input.function == "vectorSearchOramaDB"
                          AND input.callsSearch
                          AND NOT input.awaitsSearch

  unboundedSequentialCalls := input.function == "getEmbedingsAllNotes"
                              AND input.pageCount > 0
                              AND NOT input.hasBatching
                              AND NOT input.hasTimeout

  noFetchTimeout := input.function == "useGenerateEmbedding"
                    AND input.callsFetch
                    AND NOT input.hasAbortTimeout

  cascadingLoop := input.function == "checkAndIndexUpdatedPages"
                   AND input.triggeredByOnChanged
                   AND input.onChangedCausedByOwnSettingsUpdate

  RETURN missingAwaitOnInsert
         OR missingAwaitOnBatchInsert
         OR missingAwaitOnRemove
         OR missingAwaitOnSearch
         OR unboundedSequentialCalls
         OR noFetchTimeout
         OR cascadingLoop
END FUNCTION
```

### Examples

- **Hang on large vault**: User with 500+ pages calls "Index Entire Logseq". `getEmbedingsAllNotes()` fires 500 sequential OpenAI API calls with no timeout. The UI freezes for minutes. Expected: pages are processed in batches (e.g., 5 concurrent) with a 30-second timeout per call.
- **Data loss on insert**: `batchInsertEmbeddings()` calls `insertMultiple()` without `await`, then immediately calls `persist()`. The persisted JSON contains no new embeddings. Expected: `insertMultiple()` is awaited before `persist()`.
- **Infinite re-indexing**: `checkAndIndexUpdatedPages()` inserts embeddings → `batchInsertEmbeddings()` calls `logseq.updateSettings()` → `DB.onChanged()` fires → `checkAndIndexUpdatedPages()` runs again → loop. Expected: self-triggered `onChanged` events are ignored.
- **Unresolved search results**: `vectorSearchOramaDB()` returns a Promise object instead of search results because `search()` is not awaited. `handleQuery()` then fails to extract hits. Expected: `search()` is awaited and resolved results are returned.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- `handleQuery()` must continue to retrieve vector search results, construct prompts with conversation history and current page context, and return LLM responses
- Small vaults (few pages) must continue to generate and store embeddings successfully
- `loadVectorDatabase()` must continue to restore from saved JSON index or create a fresh database when settings are missing/corrupted
- `startPageIndexingOnChange()` must continue to register a `DB.onChanged()` listener that indexes pages on legitimate database changes
- Embedding API failures must continue to report the page name and a message to verify the API key

**Scope:**
All inputs that do NOT involve the seven defective async paths should be completely unaffected by this fix. This includes:
- LLM query construction and response handling
- Database creation and restoration logic
- UI rendering and user interaction flows
- Error reporting and logging behavior

## Hypothesized Root Cause

Based on code analysis, the root causes are confirmed (not hypothesized) across four files:

1. **Missing `await` on `insertMultiple()`** (`VectorDBManager.ts:55`): `batchInsertEmbeddings()` calls `insertMultiple(oramaDBInstance, Embedings)` without `await`. The subsequent `persist()` call serializes the database before data is inserted, causing data loss.

2. **Missing `await` on `batchInsertEmbeddings()`** (`manager.ts:13`, `indexManager.ts:62`): Both `indexEntireLogSeq()` and `checkAndIndexUpdatedPages()` call `batchInsertEmbeddings()` without `await`. The callers return or reset state before the database is persisted.

3. **Missing `await` on `remove()`** (`indexManager.ts:59`): `checkAndIndexUpdatedPages()` calls `remove(oramaInstance, dbRecord.id)` without `await`. The subsequent insert may conflict with the incomplete removal.

4. **Missing `await` on `search()`** (`VectorDBManager.ts:59`): `vectorSearchOramaDB()` calls `search()` without `await`, returning an unresolved Promise instead of results.

5. **Unbounded sequential API calls** (`embedManager.ts:35-62`): `getEmbedingsAllNotes()` iterates all pages in a `for` loop, making one blocking API call per page with no concurrency control, batching, or timeout.

6. **No fetch timeout** (`embedManager.ts:5-20`): `useGenerateEmbedding()` calls `fetch()` with no `AbortController` timeout. A slow or unresponsive OpenAI API hangs the application indefinitely.

7. **Cascading re-indexing loop** (`indexManager.ts:75-85` + `VectorDBManager.ts:55-58`): `batchInsertEmbeddings()` calls `logseq.updateSettings()`, which fires `DB.onChanged()`, which calls `checkAndIndexUpdatedPages()` again, creating an infinite loop. The `indexingInProgress` guard is ineffective because the non-awaited `batchInsertEmbeddings()` allows the `finally` block to reset the flag prematurely.

8. **Duplicate function** (`src/hooks/useGenerateEmbedding.ts`): A duplicate `useGenerateEmbedding()` exists without error handling. This should be removed and all imports consolidated to `src/embedManager.ts`.

## Correctness Properties

Property 1: Bug Condition - Async Operations Are Properly Awaited

_For any_ async operation in the fixed codebase where `insertMultiple()`, `batchInsertEmbeddings()`, `remove()`, or `search()` is called, the fixed code SHALL `await` the returned Promise before proceeding to subsequent operations that depend on the result, ensuring data integrity and correct return values.

**Validates: Requirements 2.2, 2.3, 2.5, 2.7, 2.8**

Property 2: Bug Condition - API Calls Have Concurrency Control and Timeouts

_For any_ invocation of `getEmbedingsAllNotes()` with N pages, the fixed function SHALL process pages in batches with bounded concurrency (e.g., 5 concurrent requests) and each `fetch()` call to the OpenAI API SHALL abort after a timeout (e.g., 30 seconds), preventing the application from hanging.

**Validates: Requirements 2.1, 2.6**

Property 3: Bug Condition - No Cascading Re-Indexing Loop

_For any_ `DB.onChanged()` event that is triggered by `batchInsertEmbeddings()` calling `logseq.updateSettings()`, the `onChanged` handler SHALL ignore the event and NOT invoke `checkAndIndexUpdatedPages()`, preventing infinite re-indexing loops.

**Validates: Requirements 2.4, 2.5**

Property 4: Preservation - LLM Query Flow Unchanged

_For any_ user query processed by `handleQuery()`, the fixed code SHALL produce the same prompt construction (conversation history, current page context, vector search context) and return the same LLM response as the original code, preserving the complete query pipeline.

**Validates: Requirements 3.1**

Property 5: Preservation - Database Load and Restore Unchanged

_For any_ call to `loadVectorDatabase()`, the fixed code SHALL produce the same database instance as the original code — restoring from saved JSON index when settings exist, or creating a fresh database when settings are missing or corrupted.

**Validates: Requirements 3.3, 3.4**

Property 6: Preservation - Legitimate OnChanged Indexing Unchanged

_For any_ `DB.onChanged()` event that is NOT triggered by the plugin's own `logseq.updateSettings()` call, the fixed code SHALL continue to invoke `checkAndIndexUpdatedPages()` to index updated pages, preserving the auto-indexing behavior.

**Validates: Requirements 3.5**

Property 7: Preservation - Error Reporting Unchanged

_For any_ embedding API call that fails for a specific page, the fixed code SHALL continue to report the error with the page name and a message to verify the API key, preserving existing error reporting behavior.

**Validates: Requirements 3.6**

## Fix Implementation

### Changes Required

**File**: `src/embedManager.ts`

**Function**: `useGenerateEmbedding()`

**Specific Changes**:
1. **Add fetch timeout**: Use `AbortController` with a 30-second timeout on the `fetch()` call. If the timeout fires, abort the request and throw a descriptive error.

**Function**: `getEmbedingsAllNotes()`

**Specific Changes**:
2. **Add batched concurrency control**: Replace the sequential `for` loop with a batched approach that processes pages in groups (e.g., 5 at a time) using `Promise.all()` on each batch. This limits concurrent API calls while still allowing parallelism within each batch.
3. **Leverage the timeout from `useGenerateEmbedding()`**: Each individual API call within the batch inherits the 30-second timeout from the fixed `useGenerateEmbedding()`.

---

**File**: `src/VectorDBManager.ts`

**Function**: `batchInsertEmbeddings()`

**Specific Changes**:
4. **Add `await` to `insertMultiple()`**: Change `insertMultiple(oramaDBInstance, Embedings)` to `await insertMultiple(oramaDBInstance, Embedings)` so that data is fully inserted before `persist()` is called.

**Function**: `vectorSearchOramaDB()`

**Specific Changes**:
5. **Add `await` to `search()`**: Change `const results = search(...)` to `const results = await search(...)` so that the function returns resolved search results instead of an unresolved Promise.

---

**File**: `src/indexManager.ts`

**Function**: `checkAndIndexUpdatedPages()`

**Specific Changes**:
6. **Add `await` to `remove()`**: Change `remove(oramaInstance, dbRecord.id)` to `await remove(oramaInstance, dbRecord.id)` so that removal completes before the subsequent insert.
7. **Add `await` to `batchInsertEmbeddings()`**: Change `batchInsertEmbeddings(oramaInstance, [newEmbedding])` to `await batchInsertEmbeddings(oramaInstance, [newEmbedding])` so that the `finally` block only resets `indexingInProgress` after all database operations complete.

**Function**: `startPageIndexingOnChange()`

**Specific Changes**:
8. **Add guard against self-triggered `onChanged` events**: Introduce a boolean flag (e.g., `isUpdatingSettings`) that is set to `true` before `logseq.updateSettings()` is called in `batchInsertEmbeddings()` and reset to `false` after. The `onChanged` handler checks this flag and skips indexing if the event was self-triggered. Alternatively, the flag can be managed in `indexManager.ts` and checked in the `onChanged` callback.

---

**File**: `src/manager.ts`

**Function**: `indexEntireLogSeq()`

**Specific Changes**:
9. **Add `await` to `batchInsertEmbeddings()`**: Change `batchInsertEmbeddings(oramaDatabaseInstance, AllEmbeddings)` to `await batchInsertEmbeddings(oramaDatabaseInstance, AllEmbeddings)` so that the function only returns after embeddings are fully persisted.

---

**File**: `src/hooks/useGenerateEmbedding.ts`

**Specific Changes**:
10. **Remove duplicate function**: Delete the duplicate `useGenerateEmbedding()` in `src/hooks/useGenerateEmbedding.ts`. Ensure all imports reference `src/embedManager.ts` instead. (Note: current imports in `indexManager.ts` already import from `embedManager`.)

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

> **Note**: The user has explicitly requested that no test files be created. The testing strategy below is documented for reference and future implementation only.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write tests that mock the Logseq API and OpenAI API, then exercise each defective code path on the UNFIXED code to observe failures.

**Test Cases**:
1. **Missing await on insertMultiple**: Call `batchInsertEmbeddings()`, then immediately check the database — data will be missing because `persist()` ran before `insertMultiple()` resolved (will fail on unfixed code)
2. **Missing await on batchInsertEmbeddings in indexEntireLogSeq**: Call `indexEntireLogSeq()`, then check the database — embeddings will not be persisted (will fail on unfixed code)
3. **Missing await on search**: Call `vectorSearchOramaDB()` and check the return type — it will be a Promise object, not resolved results (will fail on unfixed code)
4. **Cascading re-indexing**: Register `onChanged`, trigger `checkAndIndexUpdatedPages()`, and count how many times the handler fires — it will fire repeatedly (will fail on unfixed code)
5. **No fetch timeout**: Mock a never-resolving fetch and call `useGenerateEmbedding()` — it will hang indefinitely (will fail on unfixed code)

**Expected Counterexamples**:
- `batchInsertEmbeddings()` persists an empty database because `insertMultiple()` hasn't resolved
- `vectorSearchOramaDB()` returns `[object Promise]` instead of search hits
- `checkAndIndexUpdatedPages()` invocation count grows unboundedly due to cascading `onChanged` events
- `useGenerateEmbedding()` never resolves when the API is unresponsive

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := fixedFunction(input)
  ASSERT expectedBehavior(result)
END FOR
```

Specifically:
- After `batchInsertEmbeddings()` resolves, the database contains the inserted records
- After `indexEntireLogSeq()` resolves, all embeddings are persisted
- `vectorSearchOramaDB()` returns resolved search result objects with `.hits`
- `checkAndIndexUpdatedPages()` does not re-trigger itself via settings updates
- `useGenerateEmbedding()` throws a timeout error within ~30 seconds when the API is unresponsive
- `getEmbedingsAllNotes()` processes pages in bounded batches, not all sequentially

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT originalFunction(input) = fixedFunction(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for LLM queries, database loading, and error reporting, then write property-based tests capturing that behavior.

**Test Cases**:
1. **LLM Query Preservation**: Verify `handleQuery()` constructs the same prompts and returns the same LLM responses after the fix
2. **Database Load Preservation**: Verify `loadVectorDatabase()` restores/creates databases identically after the fix
3. **Legitimate OnChanged Preservation**: Verify that real page edits still trigger `checkAndIndexUpdatedPages()` after the fix
4. **Error Reporting Preservation**: Verify that embedding failures still produce the same error messages after the fix

### Unit Tests

- Test that `batchInsertEmbeddings()` awaits `insertMultiple()` before `persist()`
- Test that `vectorSearchOramaDB()` returns resolved results, not a Promise
- Test that `useGenerateEmbedding()` aborts after timeout
- Test that `getEmbedingsAllNotes()` processes pages in batches
- Test that `checkAndIndexUpdatedPages()` awaits `remove()` and `batchInsertEmbeddings()`

### Property-Based Tests

- Generate random page counts and verify `getEmbedingsAllNotes()` always completes within bounded time
- Generate random embedding data and verify `batchInsertEmbeddings()` always persists all records
- Generate random query strings and verify `handleQuery()` produces identical prompt structure

### Integration Tests

- Test full indexing flow: `indexEntireLogSeq()` → verify all embeddings persisted → query via `handleQuery()` → verify results
- Test auto-indexing flow: edit a page → `onChanged` fires → `checkAndIndexUpdatedPages()` indexes the page → no cascading loop
- Test timeout recovery: simulate slow API → verify timeout fires → verify subsequent calls succeed
