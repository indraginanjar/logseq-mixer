export {
  clearRefCache,
  useGenerateEmbedding,
  DEFAULT_EMBEDDING_MODEL,
  EMBEDDING_MODELS,
  extractOutgoingLinks,
  fetchBacklinks,
  getEmbeddingsForPage,
  getDimensionsForModel,
  isValidEmbeddingModel,
  resolveEmbeddingApiKey,
  resolveEndpoint,
  OPENAI_EMBEDDINGS_ENDPOINT,
  OLLAMA_EMBEDDINGS_ENDPOINT,
  LITELLM_EMBEDDINGS_ENDPOINT,
  OVERLAP_FRACTION,
  MAX_OVERLAP_BUDGET,
  buildPageHeader,
  createContentPreview,
  flattenBlocks,
  groupBlocksIntoChunks,
  identifySemanticGroups,
} from './embedManager';
export type { BlockLine, EmbeddingModelConfig, EmbeddingProvider, PageLinkData, VectorDBSchemaDynamic } from './embedManager';
export {
  checkAndIndexUpdatedPages,
  startPageIndexingOnChange,
  cancelAutoIndexDebounce,
  getIndexingProgress,
  isIndexingActive,
  requestPauseIndexing,
  setAutoEmbedEnabled,
  setAutoIndexDebounceSeconds,
  setIndexManagerBM25,
  purgeDeletedPages,
  _resetIndexingState,
} from './indexManager';
export type { IndexingResult, IndexingOutcome } from './indexManager';
export { buildAncestorContext, buildSubtreeChunks, computeDepthWeight } from './hierarchyChunker';
export { ChunkMigrationManager } from './chunkMigrationManager';
export type { MigrationState } from './chunkMigrationManager';
