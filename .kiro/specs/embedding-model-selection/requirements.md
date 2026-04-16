# Requirements Document

## Introduction

This feature adds user-configurable embedding model selection to the Logseq Composer plugin. Currently the plugin is hardcoded to use OpenAI's `text-embedding-ada-002` model. Users will be able to choose between `text-embedding-ada-002`, `text-embedding-3-small`, and `text-embedding-3-large` from the plugin settings. Each model produces a different vector dimension size, so the vector database schema and search must adapt accordingly. The embedding process must handle errors gracefully and must not block the Logseq UI.

## Glossary

- **Plugin**: The Logseq Composer plugin that provides LLM-powered semantic search over user notes
- **Embedding_Model_Selector**: The plugin settings control that allows the user to choose which OpenAI embedding model to use
- **Embed_Manager**: The module (`src/embedManager.ts`) responsible for generating vector embeddings via the OpenAI API
- **Vector_DB_Manager**: The module (`src/VectorDBManager.ts`) responsible for creating, persisting, and querying the Orama vector database
- **Index_Manager**: The module (`src/indexManager.ts`) responsible for incremental and auto-triggered page indexing
- **Settings_UI**: The Logseq plugin settings panel where users configure plugin options
- **Orama_Database**: The in-memory vector database (Orama) used to store and search embeddings
- **Embedding_Model**: One of the three supported OpenAI embedding models: `text-embedding-ada-002` (1536 dimensions), `text-embedding-3-small` (1536 dimensions), or `text-embedding-3-large` (3072 dimensions)

## Requirements

### Requirement 1: Embedding Model Setting

**User Story:** As a plugin user, I want to choose which OpenAI embedding model to use, so that I can balance cost, speed, and quality for my semantic search.

#### Acceptance Criteria

1. THE Settings_UI SHALL display an "Embedding Model" dropdown with the choices: `text-embedding-ada-002`, `text-embedding-3-small`, and `text-embedding-3-large`
2. THE Settings_UI SHALL default the Embedding Model selection to `text-embedding-3-small`
3. WHEN the user selects an Embedding_Model, THE Plugin SHALL persist the selection in the Logseq plugin settings under the key `embeddingModel`

### Requirement 2: Dynamic Vector Dimension Handling

**User Story:** As a plugin user, I want the vector database to automatically adapt to the selected embedding model's dimension size, so that embeddings are stored and searched correctly regardless of which model I choose.

#### Acceptance Criteria

1. WHEN the Plugin creates or restores the Orama_Database, THE Vector_DB_Manager SHALL use a vector dimension size matching the selected Embedding_Model: 1536 for `text-embedding-ada-002` and `text-embedding-3-small`, or 3072 for `text-embedding-3-large`
2. WHEN the user changes the Embedding_Model to a model with a different vector dimension size than the currently stored embeddings, THE Plugin SHALL create a fresh Orama_Database with the new dimension size and discard the old embeddings
3. WHEN the user changes the Embedding_Model to a model with the same vector dimension size, THE Plugin SHALL create a fresh Orama_Database and discard the old embeddings, because embeddings from different models are not comparable even at the same dimension

### Requirement 3: Embedding API Call Uses Selected Model

**User Story:** As a plugin user, I want all embedding API calls to use my selected model, so that my notes are embedded with the model I chose.

#### Acceptance Criteria

1. WHEN the Embed_Manager generates an embedding for any text (indexing or query), THE Embed_Manager SHALL send the selected Embedding_Model name in the `model` field of the OpenAI API request
2. WHEN the Index_Manager triggers incremental or auto-indexing, THE Index_Manager SHALL pass the selected Embedding_Model name to the Embed_Manager

### Requirement 4: Error Handling During Embedding

**User Story:** As a plugin user, I want clear error feedback when embedding fails, so that I can diagnose and fix issues without losing data.

#### Acceptance Criteria

1. IF the OpenAI API returns an error response during embedding, THEN THE Embed_Manager SHALL throw an error containing the API error message and the name of the page being processed
2. IF the OpenAI API request exceeds 30 seconds, THEN THE Embed_Manager SHALL abort the request and throw a timeout error
3. IF the Embedding API key is missing or empty, THEN THE Embed_Manager SHALL throw an error indicating that the API key is not configured, before making any API call
4. IF embedding fails for a single page during batch indexing, THEN THE Embed_Manager SHALL log the error for that page and continue processing remaining pages without aborting the entire batch
5. IF embedding fails for a single page during auto-indexing, THEN THE Index_Manager SHALL log the error and continue monitoring for future changes

### Requirement 5: Non-Blocking Embedding Process

**User Story:** As a plugin user, I want the embedding process to run without freezing the Logseq UI, so that I can continue working while my notes are being indexed.

#### Acceptance Criteria

1. WHEN the Plugin performs full re-indexing, THE Embed_Manager SHALL process pages in batches of no more than 5 concurrent API calls, yielding control between batches to prevent UI blocking
2. WHEN the Plugin performs incremental indexing, THE Index_Manager SHALL process pages sequentially with asynchronous API calls that do not block the main thread
3. WHILE indexing is in progress, THE Plugin SHALL prevent concurrent indexing runs by checking an `indexingInProgress` guard flag before starting a new indexing operation
4. WHEN the Plugin persists the Orama_Database to Logseq settings, THE Index_Manager SHALL set a guard flag to ignore the resulting `DB.onChanged` event, preventing cascading re-indexing loops

### Requirement 6: Documentation Update

**User Story:** As a developer or contributor, I want the embedding strategy documentation to reflect the new multi-model support, so that the docs stay accurate.

#### Acceptance Criteria

1. WHEN the embedding model selection feature is implemented, THE Plugin documentation (`docs/embedding-strategy.md`) SHALL list all three supported embedding models with their respective vector dimensions
2. THE Plugin documentation SHALL describe the database re-creation behavior when the user switches embedding models
