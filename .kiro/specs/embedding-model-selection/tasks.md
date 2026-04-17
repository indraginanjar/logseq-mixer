# Implementation Plan: Embedding Model Selection

## Overview

Make the OpenAI embedding model configurable by adding a settings dropdown, a centralized model config map, dynamic vector dimensions in the Orama database, model-change detection that triggers database recreation, and threading the selected model through every embedding call site.

## Tasks

- [x] 1. Add embedding model configuration and helper functions to `src/embedManager.ts`
  - [x] 1.1 Add `EmbeddingModelConfig` interface, `EMBEDDING_MODELS` constant map, `DEFAULT_EMBEDDING_MODEL`, `getDimensionsForModel()`, and `isValidEmbeddingModel()` to `src/embedManager.ts`
    - The config map is the single source of truth for model names, dimensions, and token limits
    - Three entries: `text-embedding-ada-002` (1536), `text-embedding-3-small` (1536), `text-embedding-3-large` (3072)
    - Default model: `text-embedding-3-small`
    - `getDimensionsForModel` throws on unknown model names
    - _Requirements: 2.1_

  - [x] 1.2 Update `useGenerateEmbedding` in `src/embedManager.ts` to accept a `model` parameter and validate the API key
    - Add `model: string = DEFAULT_EMBEDDING_MODEL` parameter
    - Use the `model` parameter in the OpenAI API request body instead of hardcoded `'text-embedding-ada-002'`
    - Add early validation: throw an error if `apiKey` is empty, whitespace-only, undefined, or null before making the API call
    - _Requirements: 3.1, 4.1, 4.2, 4.3_

  - [x] 1.3 Update `getEmbedingsAllNotes` and `getEmbeddingsForPage` in `src/embedManager.ts` to accept and pass through the `model` parameter
    - Both functions gain a `model` parameter that is forwarded to `useGenerateEmbedding`
    - `getEmbedingsAllNotes`: wrap individual page processing in try/catch so a single page failure logs the error and continues the batch
    - _Requirements: 3.1, 3.2, 4.4_

- [x] 2. Update `src/VectorDBManager.ts` for dynamic vector dimensions and model-change detection
  - [x] 2.1 Update `VectorDBSchema` type and `loadVectorDatabase` to accept a `model` parameter and create the Orama schema with dynamic vector dimensions
    - Import `getDimensionsForModel` and `DEFAULT_EMBEDDING_MODEL` from `embedManager`
    - `loadVectorDatabase` gains `model: string = DEFAULT_EMBEDDING_MODEL` parameter
    - `createNewDatabase()` uses `getDimensionsForModel(model)` to set the vector field size (e.g., `vector[1536]` or `vector[3072]`)
    - _Requirements: 2.1_

  - [x] 2.2 Add model-change detection logic to `loadVectorDatabase`
    - On load, compare `settings.lastEmbeddingModel` with the current `model` parameter
    - If they differ (or `lastEmbeddingModel` is missing/corrupted), force a fresh database with the new dimensions
    - Persist `lastEmbeddingModel` to settings after creating a fresh database
    - _Requirements: 2.2, 2.3_

- [x] 3. Add the embedding model setting to `src/settings.ts` and `src/state/settings.ts`
  - [x] 3.1 Add `embeddingModel` enum setting to the settings array in `src/settings.ts`
    - Key: `embeddingModel`, type: `enum`, default: `text-embedding-3-small`
    - Choices: `text-embedding-ada-002`, `text-embedding-3-small`, `text-embedding-3-large`
    - Description should note that changing the model will re-create the vector database
    - _Requirements: 1.1, 1.2, 1.3_

  - [x] 3.2 Add `embeddingModel: string` to the `IPluginSettings` interface in `src/state/settings.ts`
    - _Requirements: 1.3_

- [x] 4. Checkpoint
  - Ensure all files compile without errors, ask the user if questions arise.

- [x] 5. Thread the selected model through all call sites in `src/manager.ts`
  - [x] 5.1 Update `indexEntireLogSeq` to pass `settings.embeddingModel` to `loadVectorDatabase`, `getEmbedingsAllNotes`, and `checkAndIndexUpdatedPages`
    - _Requirements: 3.1, 3.2_

  - [x] 5.2 Update `enableAutoIndexer` to pass `settings.embeddingModel` to `loadVectorDatabase` and `startPageIndexingOnChange`
    - _Requirements: 3.2_

  - [x] 5.3 Update `handleQuery` to pass `settings.embeddingModel` to `loadVectorDatabase` and `useGenerateEmbedding`
    - _Requirements: 3.1_

- [x] 6. Update `src/indexManager.ts` to accept and forward the `model` parameter
  - [x] 6.1 Add `model` parameter to `checkAndIndexUpdatedPages` and `startPageIndexingOnChange`, and forward it to `getEmbeddingsForPage`
    - Update the module-level variable tracking to include the current model
    - _Requirements: 3.2, 5.1, 5.2, 5.3_

- [x] 7. Update `src/hooks/useVectorDBIndexed.ts` to use dynamic dimensions and model parameter
  - Replace hardcoded `vector[1536]` with a dynamic dimension lookup using `getDimensionsForModel`
  - Pass the model to `useGenerateEmbedding`
  - _Requirements: 2.1, 3.1_

- [x] 8. Checkpoint
  - Ensure all files compile without errors and the full embedding pipeline threads the model correctly from settings through to API calls. Ask the user if questions arise.

- [x] 9. Update `docs/embedding-strategy.md` to reflect multi-model support
  - List all three supported models with their dimensions and cost info
  - Document the database re-creation behavior when switching models
  - Update the architecture diagram and any references to the hardcoded model
  - _Requirements: 6.1, 6.2_

- [x] 10. Final checkpoint
  - Ensure all files compile, documentation is accurate, and the feature is fully wired. Ask the user if questions arise.

## Notes

- No test tasks are included per user instruction
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- The `EMBEDDING_MODELS` config map is the single source of truth — all dimension lookups and model validation go through it
