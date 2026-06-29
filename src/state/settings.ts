import { atom, AtomEffect } from 'recoil';
import settings from '../settings';

interface IPluginSettings {
  selectedModel: string;
  prompt: string;
  EmbeddingApiKey: string;
  LiteLLMLink: string;
  apiKey: string;
  embeddingModel: string;
  VectorDBLogseqCopilot: string;
  autoEmbedEnabled: boolean;
  autoIndexDebounceSeconds: number;
  storageBackend?: string;
  embeddingProvider?: string;
  memoryEnabled?: boolean;
  autoSummarize?: boolean;
  memoryBudgetPercent?: number;
  agentMode?: string;
  agentConfidenceThreshold?: number;
  agentAutonomy?: string;
  agentTokenBudget?: number;
  agentMaxRetries?: number;
  agentVerboseMode?: boolean;
}

const settingsChangedEffect: AtomEffect<IPluginSettings> = ({ setSelf }) => {
  setSelf({ ...logseq.settings } as unknown as IPluginSettings);
  const unlisten = logseq.onSettingsChanged((newSettings) => {
    setSelf(newSettings);
  });
  return () => unlisten();
};

export const settingsState = atom<IPluginSettings>({
  key: 'settings',
  default: settings.reduce((result, item) => ({ ...result, [item.key]: item.default }), {}) as IPluginSettings,
  effects: [settingsChangedEffect],
});

export const aiEditModeState = atom<boolean>({
  key: 'aiEditMode',
  default: false,
});