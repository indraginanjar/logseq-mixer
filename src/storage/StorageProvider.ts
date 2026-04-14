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

  /** Remove all document rows and flush to IndexedDB */
  clear(): Promise<void>;

  /** Export the SQLite database as a downloadable file (optional) */
  exportToFile?(): void;

  // --- Legacy methods used by SettingsStorageProvider + Orama backend ---

  /** Save serialized data (legacy Orama JSON blob) */
  save?(data: string): Promise<void>;

  /** Load serialized data (legacy Orama JSON blob) */
  load?(): Promise<string | null>;
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
}
