import { setIsUpdatingSettings } from '../indexManager';
import type { StorageProvider } from './StorageProvider';

export class SettingsStorageProvider implements StorageProvider {
  async save(data: string): Promise<void> {
    setIsUpdatingSettings(true);
    try {
      await logseq.updateSettings({ VectorDBLogseqCopilot: data });
    } finally {
      setIsUpdatingSettings(false);
    }
  }

  async load(): Promise<string | null> {
    const data = logseq.settings?.VectorDBLogseqCopilot;
    if (!data || data === '') return null;
    return data as string;
  }

  async clear(): Promise<void> {
    setIsUpdatingSettings(true);
    try {
      await logseq.updateSettings({ VectorDBLogseqCopilot: '' });
    } finally {
      setIsUpdatingSettings(false);
    }
  }
}
