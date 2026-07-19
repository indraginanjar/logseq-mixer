export interface DocumentRecord {
  id: string;
  content: string;
  lastUpdated: number;
  embedding: number[];
}

export interface SearchResult {
  id: string;
  content: string;
  score: number;
}

export interface StorageProvider {
  /** Insert or replace multiple documents in a single transaction, then flush to IndexedDB */
  upsertDocuments?(docs: DocumentRecord[]): Promise<void>;

  /** Delete documents by their ids, then flush to IndexedDB */
  deleteDocuments?(ids: string[]): Promise<void>;

  /** Brute-force cosine similarity search, returns top-K results above threshold */
  searchByVector?(queryVector: number[], limit: number, threshold: number): Promise<SearchResult[]>;

  /** Get the lastUpdated timestamp for a document, or null if not found. Does NOT load the embedding BLOB. */
  getDocumentMeta?(id: string): Promise<number | null>;

  /** Get the total number of documents in the store. */
  getDocumentCount?(): Promise<number>;

  /** Get the number of distinct pages (unique base IDs, stripping _chunk_N suffixes). */
  getPageCount?(): Promise<number>;

  /** Remove all document rows and flush to IndexedDB */
  clear(): Promise<void>;

  /** Export the SQLite database as a downloadable file (optional) */
  exportToFile?(): void;

  /** Import a SQLite database from an ArrayBuffer, replacing existing data (optional) */
  importFromFile?(buffer: ArrayBuffer): Promise<void>;

  /** Get the size of the database in bytes (optional) */
  getDatabaseSize?(): Promise<number>;

}

/**
 * A StorageProvider that supports per-document operations (SQLiteVectorStore).
 * Used as the narrowed type after duck-typing checks.
 */
export interface PerDocumentStorageProvider extends StorageProvider {
  upsertDocuments(docs: DocumentRecord[]): Promise<void>;
  deleteDocuments(ids: string[]): Promise<void>;
  searchByVector(queryVector: number[], limit: number, threshold: number): Promise<SearchResult[]>;
  getDocumentMeta(id: string): Promise<number | null>;
  getAllDocumentContent(): Array<{ id: string; content: string }>;
  beginBulk?(): void;
  endBulk?(): void;
  persistToIndexedDB?(): Promise<void>;
  importFromFile?(buffer: ArrayBuffer): Promise<void>;
  getDatabaseSize?(): Promise<number>;

  /** Upsert block metadata records. */
  upsertBlockMetadata?(entries: Array<{ uuid: string; pageName: string; contentPreview: string }>): void;
  /** Delete block metadata for a page. */
  deleteBlockMetadataForPage?(pageName: string): void;
  /** Clear all block metadata. */
  clearBlockMetadata?(): void;
  /** Look up block metadata by UUID. */
  getBlockMetadata?(uuid: string): { pageName: string; contentPreview: string } | null;

  /** Return the set of distinct page IDs that have indexed documents. */
  getIndexedPageIds?(): Set<string>;
  /** Return all document (chunk) IDs belonging to a given page ID. */
  getDocumentIdsForPage?(pageId: string): string[];
  /** Delete block_metadata entries whose pageName matches any of the given names. */
  deleteBlockMetadataForPages?(pageNames: string[]): void;
}
