import { SQLiteVectorStore } from './SQLiteVectorStore';
import { SettingsStorageProvider } from './SettingsStorageProvider';
import type { StorageProvider } from './StorageProvider';

export async function createStorageProvider(
  backend: 'sqlite' | 'settings'
): Promise<StorageProvider> {
  if (backend === 'sqlite') {
    try {
      const graph = await logseq.App.getCurrentGraph();
      console.info('[createStorageProvider] Graph:', JSON.stringify(graph));
      if (!graph?.path) {
        console.warn('[createStorageProvider] Could not resolve graph path. Falling back to settings backend.');
        // Legacy path: SettingsStorageProvider uses save/load (Orama-based), not the new StorageProvider interface.
        // Callers (indexManager, manager) use duck-typing to branch between the two backends.
        return new SettingsStorageProvider() as any;
      }
      const provider = new SQLiteVectorStore(graph.path);
      await provider.initialize();
      console.info('[createStorageProvider] SQLite backend initialized successfully.');
      return provider;
    } catch (err) {
      console.error('[createStorageProvider] Failed to initialize SQLite backend:', err);
      console.warn('[createStorageProvider] Falling back to settings backend.');
      // Legacy fallback: see comment above about SettingsStorageProvider interface mismatch.
      return new SettingsStorageProvider() as any;
    }
  }
  // Legacy path: SettingsStorageProvider uses save/load (Orama-based), not the new StorageProvider interface.
  // Callers (indexManager, manager) use duck-typing to branch between the two backends.
  return new SettingsStorageProvider() as any;
}
