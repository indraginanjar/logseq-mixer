import { useEffect, useState } from 'react';
import { fetchModelsForProvider, resolveApiKey } from '../LLMManager';

interface Settings {
  selectedModel?: string;
  chatProvider?: string;
  chatEndpoint?: string;
  openaiEndpoint?: string;
  ollamaEndpoint?: string;
  litellmEndpoint?: string;
  LiteLLMLink?: string;
  apiKey?: string;
  openaiApiKey?: string;
  ollamaApiKey?: string;
  litellmApiKey?: string;
  reasoningEffort?: string;
}

const providerModelKey = 'logseq-mixer-provider-models';

function getProviderModels(): Record<string, string> {
  try {
    const stored = localStorage.getItem(providerModelKey);
    return stored ? JSON.parse(stored) : {};
  } catch { return {}; }
}

function saveProviderModel(provider: string, model: string) {
  const map = getProviderModels();
  map[provider] = model;
  localStorage.setItem(providerModelKey, JSON.stringify(map));
}

export function useModelSelection(settings: Settings) {
  const currentModel = settings?.selectedModel || 'gpt-3.5-turbo';
  const chatProvider = settings?.chatProvider || 'openai';
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);

  // When provider changes, restore the last model used with that provider
  useEffect(() => {
    const provider = settings?.chatProvider || 'openai';
    const providerModels = getProviderModels();
    const lastModelForProvider = providerModels[provider];
    if (lastModelForProvider && lastModelForProvider !== settings?.selectedModel) {
      logseq.updateSettings({ selectedModel: lastModelForProvider });
    }
  }, [settings?.chatProvider]);

  // Save current model to per-provider memory when it changes
  useEffect(() => {
    const provider = settings?.chatProvider || 'openai';
    if (settings?.selectedModel) {
      saveProviderModel(provider, settings.selectedModel);
    }
  }, [settings?.selectedModel, settings?.chatProvider]);

  // Fetch available models from provider
  useEffect(() => {
    const provider = settings?.chatProvider || 'openai';

    const loadModels = async () => {
      // Resolve the effective endpoint for this provider
      const endpoint = (provider === 'openai' ? settings?.openaiEndpoint?.trim() : '')
        || (provider === 'ollama' ? settings?.ollamaEndpoint?.trim() : '')
        || (provider === 'litellm' ? settings?.litellmEndpoint?.trim() : '')
        || settings?.chatEndpoint?.trim()
        || (provider === 'openai' ? 'https://api.openai.com/v1/chat/completions' : '')
        || (provider === 'ollama' ? 'http://localhost:11434/api/chat' : '')
        || settings?.LiteLLMLink
        || 'http://127.0.0.1:4000/chat/completions';

      if (!endpoint) {
        setFetchedModels([]);
        return;
      }

      try {
        const models = await fetchModelsForProvider(provider, endpoint, resolveApiKey(settings || {}));
        if (models && models.length > 0) {
          setFetchedModels(models);
        } else {
          setFetchedModels([]);
        }
      } catch (err) {
        console.warn(`Failed to fetch models for ${provider}:`, err);
        setFetchedModels([]);
      }
    };
    loadModels();
  }, [settings?.chatProvider, settings?.openaiEndpoint, settings?.ollamaEndpoint, settings?.litellmEndpoint, settings?.chatEndpoint, settings?.LiteLLMLink, settings?.apiKey, settings?.openaiApiKey, settings?.ollamaApiKey, settings?.litellmApiKey]);

  // Model choices: fetched list if available, otherwise just the current model
  const modelChoices = fetchedModels.length > 0
    ? (fetchedModels.includes(currentModel) ? fetchedModels : [currentModel, ...fetchedModels])
    : [currentModel];

  const handleModelChange = (newModel: string) => {
    logseq.updateSettings({ selectedModel: newModel });
  };

  const handleEffortChange = (level: string) => {
    logseq.updateSettings({ reasoningEffort: level });
  };

  return { modelChoices, currentModel, handleModelChange, handleEffortChange };
}
