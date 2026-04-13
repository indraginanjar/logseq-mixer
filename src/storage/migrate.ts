import type { StorageProvider } from './StorageProvider';

export async function migrateStorage(
  source: StorageProvider,
  target: StorageProvider
): Promise<boolean> {
  try {
    const data = await source.load();
    if (!data) {
      console.warn('Migration: no data in source backend. Starting fresh.');
      return false;
    }
    await target.save(data);
    await source.clear();
    return true;
  } catch (err) {
    console.error('Migration failed:', err);
    return false;
  }
}
