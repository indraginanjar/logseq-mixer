import initSqlJs, { type Database } from 'sql.js';
import { cosineSimilarity, decodeEmbedding } from '../storage/cosineSimilarity';
import { BM25Index } from './bm25Index';

export interface CrossGraphSource {
  /** File system path of the graph (used as IDB key). */
  path: string;
  /** Human-readable label (e.g., "Work Notes"). */
  label: string;
  /** Embedding model used when this graph was indexed. */
  embeddingModel?: string;
  /** Timestamp of the last time this graph was indexed. */
  lastIndexed?: number;
}

export interface CrossGraphHit {
  id: string;
  content: string;
  rrfScore: number;
  sourceGraph: string; // label of the source graph
  sourceGraphPath: string;
}

/** IDB constants matching SQLiteVectorStore. */
const IDB_DB_NAME = 'logseq-mixer-vectors';
const IDB_STORE_NAME = 'sqlite';

/**
 * Open a read-only SQLite database from IndexedDB for a given graph path.
 * Returns null if the graph has no indexed data.
 */
async function openGraphDatabase(graphPath: string): Promise<Database | null> {
  const idbKey = `vectors:${graphPath}`;

  // Open IDB
  const idb = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(IDB_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
        db.createObjectStore(IDB_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  // Load the buffer
  const buffer = await new Promise<ArrayBuffer | null>((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE_NAME, 'readonly');
    const store = tx.objectStore(IDB_STORE_NAME);
    const request = store.get(idbKey);
    request.onsuccess = () => { idb.close(); resolve(request.result ?? null); };
    request.onerror = () => { idb.close(); reject(request.error); };
  });

  if (!buffer) return null;

  // Initialize sql.js and open the database
  const basePath = ((window as any).logseq?.baseInfo as any)?.path ?? '';
  let wasmUrl = 'sql-wasm.wasm';
  if (basePath) {
    wasmUrl = basePath.replace(/[\/\\]?$/, '/') + 'dist/sql-wasm.wasm';
  }

  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  return new SQL.Database(new Uint8Array(buffer));
}

/**
 * Search a single external graph's database.
 * Performs both vector search and BM25 keyword search, returns merged results.
 */
async function searchExternalGraph(
  db: Database,
  queryEmbedding: Float32Array | number[],
  queryText: string,
  source: CrossGraphSource,
  topK: number = 10
): Promise<CrossGraphHit[]> {
  const hits: CrossGraphHit[] = [];

  // Ensure queryEmbedding is Float32Array for cosine similarity
  const queryVec = queryEmbedding instanceof Float32Array
    ? queryEmbedding
    : new Float32Array(queryEmbedding);

  // --- Vector search ---
  try {
    const rows = db.exec('SELECT id, content, embedding FROM documents');
    if (rows.length > 0 && rows[0].values.length > 0) {
      const scored: Array<{ id: string; content: string; score: number }> = [];

      for (const row of rows[0].values) {
        const id = row[0] as string;
        const content = row[1] as string;
        const embBlob = row[2] as Uint8Array;
        try {
          const embedding = decodeEmbedding(embBlob);
          if (embedding.length !== queryVec.length) continue; // dimension mismatch
          const score = cosineSimilarity(queryVec, embedding);
          if (score > 0.3) { // minimum threshold
            scored.push({ id, content, score });
          }
        } catch {
          // Skip malformed embeddings
        }
      }

      scored.sort((a, b) => b.score - a.score);
      const topVector = scored.slice(0, topK);

      for (let i = 0; i < topVector.length; i++) {
        const rank = i + 1;
        hits.push({
          id: topVector[i].id,
          content: topVector[i].content,
          rrfScore: 1 / (60 + rank), // RRF with k=60
          sourceGraph: source.label,
          sourceGraphPath: source.path,
        });
      }
    }
  } catch (err) {
    console.warn(`[CrossGraphSearch] Vector search failed for "${source.label}":`, err);
  }

  // --- BM25 keyword search ---
  try {
    const rows = db.exec('SELECT id, content FROM documents');
    if (rows.length > 0 && rows[0].values.length > 0) {
      const bm25 = new BM25Index();
      const docs = rows[0].values.map(row => ({
        id: row[0] as string,
        content: row[1] as string,
      }));
      bm25.buildFromDocuments(docs);
      const bm25Results = bm25.search(queryText, topK);

      const existingIds = new Set(hits.map(h => h.id));
      for (let i = 0; i < bm25Results.length; i++) {
        const rank = i + 1;
        const rrf = 1 / (60 + rank);
        if (existingIds.has(bm25Results[i].id)) {
          // Boost existing hit
          const existing = hits.find(h => h.id === bm25Results[i].id);
          if (existing) existing.rrfScore += rrf;
        } else {
          hits.push({
            id: bm25Results[i].id,
            content: bm25Results[i].content,
            rrfScore: rrf,
            sourceGraph: source.label,
            sourceGraphPath: source.path,
          });
        }
      }
    }
  } catch (err) {
    console.warn(`[CrossGraphSearch] BM25 search failed for "${source.label}":`, err);
  }

  // Sort by score and return top results
  hits.sort((a, b) => b.rrfScore - a.rrfScore);
  return hits.slice(0, topK);
}

/**
 * Search across multiple external graphs.
 * Opens each graph's database, runs hybrid search, and merges results.
 *
 * @param queryEmbedding - The embedding vector for the query
 * @param queryText - The raw query text for BM25
 * @param sources - List of external graphs to search
 * @param topK - Max results per graph (default 5)
 * @returns Merged cross-graph hits with source attribution
 */
export async function searchCrossGraphs(
  queryEmbedding: Float32Array | number[],
  queryText: string,
  sources: CrossGraphSource[],
  topK: number = 5
): Promise<CrossGraphHit[]> {
  if (sources.length === 0) return [];

  const allHits: CrossGraphHit[] = [];

  for (const source of sources) {
    try {
      const db = await openGraphDatabase(source.path);
      if (!db) {
        console.info(`[CrossGraphSearch] No indexed data for "${source.label}" (${source.path})`);
        continue;
      }

      const hits = await searchExternalGraph(db, queryEmbedding, queryText, source, topK);
      allHits.push(...hits);

      // Close the database to free memory
      db.close();
    } catch (err) {
      console.warn(`[CrossGraphSearch] Failed to search "${source.label}":`, err);
    }
  }

  // Sort all cross-graph hits by score, apply a discount factor (0.85) since
  // cross-graph results are inherently less relevant than current-graph results
  allHits.sort((a, b) => b.rrfScore - a.rrfScore);
  return allHits.slice(0, topK * 2).map(hit => ({
    ...hit,
    rrfScore: hit.rrfScore * 0.85,
  }));
}

// --- Settings persistence helpers ---

const CROSS_GRAPH_SOURCES_PREFIX = 'logseq-mixer:cross-graph-sources:';

/** Get the localStorage key for the current graph's cross-graph sources. */
function getSourcesKey(currentGraphPath: string): string {
  return CROSS_GRAPH_SOURCES_PREFIX + currentGraphPath;
}

/** Get the current graph path. */
export async function getCurrentGraphPath(): Promise<string | null> {
  try {
    const graph = await logseq.App.getCurrentGraph();
    return graph?.path ?? null;
  } catch {
    return null;
  }
}

/** Load registered cross-graph sources for a specific graph. */
export function loadCrossGraphSources(currentGraphPath?: string): CrossGraphSource[] {
  try {
    if (!currentGraphPath) {
      // Fallback: try all keys with prefix and return empty
      return [];
    }
    const stored = localStorage.getItem(getSourcesKey(currentGraphPath));
    // Filter out the current graph itself (shouldn't be there, but safety check)
    const sources: CrossGraphSource[] = stored ? JSON.parse(stored) : [];
    return sources.filter(s => s.path !== currentGraphPath);
  } catch {
    return [];
  }
}

/** Save cross-graph sources for a specific graph. */
export function saveCrossGraphSources(sources: CrossGraphSource[], currentGraphPath: string): void {
  localStorage.setItem(getSourcesKey(currentGraphPath), JSON.stringify(sources));
}

/** Add a cross-graph source. Returns false if already registered or is the current graph. */
export function addCrossGraphSource(source: CrossGraphSource, currentGraphPath: string): boolean {
  if (source.path === currentGraphPath) return false; // Can't add self
  const existing = loadCrossGraphSources(currentGraphPath);
  if (existing.some(s => s.path === source.path)) return false;
  existing.push(source);
  saveCrossGraphSources(existing, currentGraphPath);
  return true;
}

/** Remove a cross-graph source by path. */
export function removeCrossGraphSource(path: string, currentGraphPath: string): void {
  const existing = loadCrossGraphSources(currentGraphPath);
  saveCrossGraphSources(existing.filter(s => s.path !== path), currentGraphPath);
}
