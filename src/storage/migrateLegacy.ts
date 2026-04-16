import type { Database } from 'sql.js';
import { encodeEmbedding } from './cosineSimilarity';

/** Batch size for chunked migration to limit memory pressure (Req 6.6). */
const MIGRATION_BATCH_SIZE = 500;

/**
 * Represents a single document extracted from the legacy Orama JSON blob.
 */
interface OramaDoc {
  id: string;
  content: string;
  lastUpdated: number;
  embedding: number[];
}

/**
 * Extract documents from the legacy Orama JSON blob stored in `kv_store`
 * and insert them into the new `documents` table. Processes in chunks
 * to limit memory usage.
 *
 * After successful migration, deletes the `orama_db` entry from `kv_store`
 * to prevent re-migration on subsequent startups (Req 6.4).
 *
 * If the JSON is corrupted or unparseable, logs a warning and returns
 * with zero migrated documents (Req 6.5).
 */
export function migrateLegacyOrama(db: Database): { migrated: number; errors: number } {
  const stats = { migrated: 0, errors: 0 };

  // 1. Read orama_db from kv_store
  let raw: string;
  try {
    const result = db.exec("SELECT value FROM kv_store WHERE key = 'orama_db'");
    if (result.length === 0 || result[0].values.length === 0) {
      return stats;
    }
    raw = result[0].values[0][0] as string;
  } catch (err) {
    console.warn('[migrateLegacyOrama] Failed to read orama_db from kv_store:', err);
    return stats;
  }

  // 2. Parse the Orama JSON structure (Req 6.5: catch corrupted JSON)
  let docsMap: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw);
    docsMap = parsed?.data?.docs?.docs;
    if (!docsMap || typeof docsMap !== 'object') {
      console.warn('[migrateLegacyOrama] Orama JSON missing data.docs.docs structure.');
      return stats;
    }
  } catch (err) {
    console.warn('[migrateLegacyOrama] Orama JSON is corrupted/unparseable:', err);
    return stats;
  }

  // 3. Extract document entries and process in chunks (Req 6.6)
  const keys = Object.keys(docsMap);
  for (let i = 0; i < keys.length; i += MIGRATION_BATCH_SIZE) {
    const batchKeys = keys.slice(i, i + MIGRATION_BATCH_SIZE);

    db.run('BEGIN TRANSACTION');
    for (const key of batchKeys) {
      try {
        const entry = docsMap[key] as Record<string, unknown>;
        const doc = extractDoc(entry);
        const embeddingBlob = encodeEmbedding(doc.embedding);
        db.run(
          'INSERT OR REPLACE INTO documents (id, content, lastUpdated, embedding) VALUES (?, ?, ?, ?)',
          [doc.id, doc.content, doc.lastUpdated, embeddingBlob as any]
        );
        stats.migrated++;
      } catch (err) {
        // Individual document extraction/insert failure: log and continue
        console.error(`[migrateLegacyOrama] Failed to migrate document (key="${key}"):`, err);
        stats.errors++;
      }
    }
    db.run('COMMIT');
  }

  // 4. Delete orama_db entry to prevent re-migration (Req 6.4)
  try {
    db.run("DELETE FROM kv_store WHERE key = 'orama_db'");
  } catch (err) {
    console.error('[migrateLegacyOrama] Failed to delete orama_db entry:', err);
  }

  console.info(
    `[migrateLegacyOrama] Migration complete: ${stats.migrated} migrated, ${stats.errors} errors.`
  );
  return stats;
}

/**
 * Extract and validate a single document from an Orama docs entry.
 * Throws if required fields are missing or invalid.
 */
function extractDoc(entry: Record<string, unknown>): OramaDoc {
  if (!entry || typeof entry !== 'object') {
    throw new TypeError('Entry is not an object');
  }

  const id = entry.id;
  if (typeof id !== 'string' && typeof id !== 'number') {
    throw new TypeError(`Invalid id: ${String(id)}`);
  }

  const content = entry.content;
  if (typeof content !== 'string') {
    throw new TypeError(`Invalid content for id "${String(id)}"`);
  }

  const lastUpdated = entry.lastUpdated;
  if (typeof lastUpdated !== 'number') {
    throw new TypeError(`Invalid lastUpdated for id "${String(id)}"`);
  }

  const embedding = entry.embedding;
  if (!Array.isArray(embedding)) {
    throw new TypeError(`Invalid embedding for id "${String(id)}"`);
  }

  return {
    id: String(id),
    content,
    lastUpdated,
    embedding: embedding as number[],
  };
}
