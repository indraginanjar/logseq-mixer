import { SQLiteStorageProvider } from './SQLiteStorageProvider';
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
        return new SettingsStorageProvider();
      }
      const provider = new SQLiteStorageProvider(graph.path);
      await provider.initialize();
      console.info('[createStorageProvider] SQLite backend initialized successfully.');
      return provider;
    } catch (err) {
      console.error('[createStorageProvider] Failed to initialize SQLite backend:', err);
      console.warn('[createStorageProvider] Falling back to settings backend.');
      return new SettingsStorageProvider();
    }
  }
  return new SettingsStorageProvider();
}
