# Requirements Document

## Introduction

This feature improves the embedding pipeline quality for the Logseq Composer plugin. The current implementation produces functional embeddings but has several areas where retrieval quality can be improved: chunk boundaries lose semantic context, the graph structure of Logseq is ignored, duplicate content wastes tokens, markdown noise pollutes embeddings, and search relies solely on vector similarity. These six improvements — chunk overlap, semantic-aware chunking, graph-aware embedding, query-time reranking, content deduplication, and markdown normalization — collectively produce higher-quality embeddings and more relevant retrieval results.

## Glossary

- **Chunker**: The module responsible for splitting page content into chunks for embedding (currently `groupBlocksIntoChunks()` in `src/embedManager.ts`)
- **Block_Flattener**: The module that recursively traverses a page's block tree and produces a flat list of content lines (currently `flattenBlocks()` in `src/embedManager.ts`)
- **Embedding_Pipeline**: The end-to-end process of flattening blocks, normalizing content, deduplicating, chunking, and generating embeddings for storage in the vector database
- **Page_Header**: The metadata string prepended to each chunk containing page ID, name, tags, and graph context
- **Retrieval_Pipeline**: The query-time process of embedding a query, performing vector search, reranking results, and injecting context into the LLM prompt (orchestrated in `src/manager.ts`)
- **Vector_Store**: The Orama in-memory vector database used for storing and searching embeddings (`src/VectorDBManager.ts`)
- **Normalizer**: The module responsible for stripping or normalizing markdown syntax from block content before embedding
- **Reranker**: The module that applies keyword-based reciprocal rank fusion (RRF) scoring after initial vector similarity search to improve result relevance
- **Deduplicator**: The module that identifies and removes duplicate block content across pages before embedding
- **Chunk_Overlap**: The technique of repeating the last few block lines from the previous chunk at the start of the next chunk to preserve semantic continuity
- **RRF (Reciprocal Rank Fusion)**: A rank aggregation method that combines rankings from multiple sources (vector similarity and keyword matching) using the formula `1 / (k + rank)` where k is a constant

## Requirements

### Requirement 1: Chunk Overlap

**User Story:** As a user, I want chunk boundaries to preserve semantic context, so that retrieval does not miss relevant information split across two adjacent chunks.

#### Acceptance Criteria

1. WHEN a page produces multiple chunks, THE Chunker SHALL repeat the last N block lines from the previous chunk at the start of the next chunk, where N represents approximately 10-20% of the block lines in the previous chunk.
2. WHEN a page produces only a single chunk, THE Chunker SHALL produce that chunk without any overlap lines.
3. THE Chunker SHALL ensure that each chunk, including overlap lines and the Page_Header, does not exceed the maximum chunk character limit for the selected embedding model.
4. WHEN the overlap lines alone would exceed 20% of the maximum chunk character limit, THE Chunker SHALL reduce the number of overlap lines to stay within the 20% budget.
5. THE Chunker SHALL preserve the original order of block lines within each chunk, with overlap lines appearing before new content.

### Requirement 2: Semantic-Aware Chunking

**User Story:** As a user, I want heading blocks and their child blocks to stay together in the same chunk, so that topically related content is not split across chunk boundaries.

#### Acceptance Criteria

1. WHEN a block is a heading block (content starts with `#` markdown heading syntax), THE Chunker SHALL treat that heading block and all its direct and nested child blocks as a semantic group.
2. WHEN a semantic group fits within the remaining space of the current chunk, THE Chunker SHALL keep the entire group in the current chunk.
3. WHEN a semantic group does not fit in the current chunk but fits in a fresh chunk, THE Chunker SHALL start a new chunk and place the entire semantic group there.
4. WHEN a semantic group exceeds the maximum chunk character limit for a single chunk, THE Chunker SHALL split the group across multiple chunks, preferring to split between child blocks rather than within a block.
5. WHEN a block is not part of a heading-based semantic group, THE Chunker SHALL fall back to the existing adjacency-based chunking behavior.

### Requirement 3: Graph-Aware Embedding

**User Story:** As a user, I want my embeddings to capture the graph structure of my Logseq knowledge base, so that queries about linked topics return relevant results even when the exact terms are not in the page content.

#### Acceptance Criteria

1. WHEN building the Page_Header for a page that contains outgoing page links (`[[page_name]]` syntax), THE Embedding_Pipeline SHALL include a `note_links` field listing the names of all linked pages.
2. WHEN building the Page_Header for a page that has incoming links (backlinks) from other pages, THE Embedding_Pipeline SHALL include a `note_backlinks` field listing the names of all pages that link to the current page.
3. THE Embedding_Pipeline SHALL retrieve backlink information using the Logseq API (`logseq.Editor.getPageLinkedReferences` or equivalent).
4. WHEN a page has no outgoing links, THE Embedding_Pipeline SHALL omit the `note_links` field from the Page_Header.
5. WHEN a page has no backlinks, THE Embedding_Pipeline SHALL omit the `note_backlinks` field from the Page_Header.
6. THE Embedding_Pipeline SHALL extract outgoing link names by parsing `[[page_name]]` patterns from the flattened block content.

### Requirement 4: Query-Time Reranking with Reciprocal Rank Fusion

**User Story:** As a user, I want search results to combine semantic similarity with keyword matching, so that results containing my exact query terms are ranked higher.

#### Acceptance Criteria

1. WHEN the Retrieval_Pipeline receives vector search results, THE Reranker SHALL compute a keyword match score for each result by counting the number of query terms that appear in the result content.
2. THE Reranker SHALL combine the vector similarity rank and the keyword match rank using reciprocal rank fusion with the formula `rrf_score = 1/(k + vector_rank) + 1/(k + keyword_rank)` where k is a constant set to 60.
3. THE Reranker SHALL sort the final results by descending RRF score before injecting them into the LLM prompt.
4. WHEN the vector search returns results, THE Reranker SHALL perform case-insensitive keyword matching against the query terms.
5. THE Reranker SHALL use the same result limit (5 results) as the current vector search configuration.
6. WHEN the vector search returns zero results, THE Reranker SHALL return an empty result set without error.

### Requirement 5: Content Deduplication

**User Story:** As a user, I want duplicate block content (from block references and embeds) to be deduplicated before embedding, so that token budget is not wasted on redundant content and search results are not diluted.

#### Acceptance Criteria

1. WHEN the same block content appears in multiple pages due to block references or block embeds, THE Deduplicator SHALL embed the content only once and skip duplicate occurrences during indexing.
2. THE Deduplicator SHALL identify duplicates by comparing the resolved text content of blocks after reference resolution, using exact string matching.
3. WHEN a duplicate block is skipped, THE Deduplicator SHALL retain the first occurrence encountered during the indexing run.
4. THE Deduplicator SHALL operate at the block-line level within the flattened block list, before chunk grouping occurs.
5. WHEN performing incremental indexing for a single page, THE Deduplicator SHALL deduplicate blocks within that page only, without requiring a full cross-page scan.
6. WHEN performing full indexing, THE Deduplicator SHALL deduplicate blocks across all pages.

### Requirement 6: Markdown Normalization

**User Story:** As a user, I want markdown formatting syntax stripped from block content before embedding, so that the embedding model receives cleaner semantic content without noise from formatting characters.

#### Acceptance Criteria

1. THE Normalizer SHALL remove heading markers (`#`, `##`, `###`, etc.) from block content before embedding.
2. THE Normalizer SHALL remove bold markers (`**text**` and `__text__`) while preserving the enclosed text.
3. THE Normalizer SHALL remove italic markers (`*text*` and `_text_`) while preserving the enclosed text.
4. THE Normalizer SHALL remove strikethrough markers (`~~text~~`) while preserving the enclosed text.
5. THE Normalizer SHALL remove highlight markers (`==text==`) while preserving the enclosed text.
6. THE Normalizer SHALL normalize checkbox syntax (`- [ ]`, `- [x]`, `- [X]`) to plain list items (`- `).
7. THE Normalizer SHALL remove blockquote markers (`>`) while preserving the quoted text.
8. THE Normalizer SHALL remove inline code backticks (`` `code` ``) while preserving the code text.
9. THE Normalizer SHALL preserve page link content by converting `[[page name]]` to `page name`.
10. THE Normalizer SHALL preserve the semantic content of the block after all normalization operations.
11. THE Normalizer SHALL apply normalization after block reference resolution and before chunk grouping.
12. WHEN normalizing content, THE Normalizer SHALL not modify the Page_Header metadata fields.
