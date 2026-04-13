export interface StorageProvider {
  /** Persist the serialized Orama JSON string */
  save(data: string): Promise<void>;

  /** Load the serialized Orama JSON string, or null if none exists */
  load(): Promise<string | null>;

  /** Remove all persisted vector DB data */
  clear(): Promise<void>;

  /** Export the database to a downloadable file (optional, only supported by SQLite backend) */
  exportToFile?(): void;
}
