import { SQLiteVectorStore } from './SQLiteVectorStore';
import type { StorageProvider } from './StorageProvider';

export async function createStorageProvider(): Promise<StorageProvider> {
  const graph = await logseq.App.getCurrentGraph();
  if (!graph?.path) {
    throw new Error('Could not resolve graph path for SQLite storage.');
  }
  const provider = new SQLiteVectorStore(graph.path);
  await provider.initialize();
  console.info('[createStorageProvider] SQLite backend initialized successfully.');
  return provider;
}
