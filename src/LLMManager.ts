
export type MessageContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

/** Default chat endpoints per provider. Used when chatEndpoint is empty. */
const DEFAULT_CHAT_ENDPOINTS: Record<string, string> = {
  openai: 'https://api.openai.com/v1/chat/completions',
  ollama: 'http://localhost:11434/api/chat',
  litellm: 'http://127.0.0.1:4000/chat/completions',
};

/**
 * Resolve the effective chat endpoint from settings.
 * Priority: chatEndpoint (if non-empty) → provider default → legacy LiteLLMLink fallback.
 */
export function resolveChatEndpoint(settings: { chatEndpoint?: string; chatProvider?: string; LiteLLMLink?: string }): string {
  if (settings.chatEndpoint && settings.chatEndpoint.trim()) {
    return settings.chatEndpoint.trim();
  }
  const provider = settings.chatProvider || 'litellm';
  if (DEFAULT_CHAT_ENDPOINTS[provider]) {
    return DEFAULT_CHAT_ENDPOINTS[provider];
  }
  // Ultimate fallback for unknown providers: use LiteLLMLink or OpenAI default
  return settings.LiteLLMLink || DEFAULT_CHAT_ENDPOINTS.openai;
}

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | MessageContentPart[];
  name?: string;
  tool_call_id?: string;
  tool_calls?: any[];
};

/** Max output tokens per model. Falls back to 4096 for unknown models. */
const MODEL_MAX_TOKENS: Record<string, number> = {
  'gpt-3.5-turbo': 4096,
  'gpt-4': 8192,
  'gpt-4o': 16384,
  'claude-2': 4096,
  'claude-3-opus': 4096,
  'gemini-pro': 8192,
  'codestral/codestral-latest': 8192,
  'deepseek-chat': 8192,
};

const DEFAULT_MAX_TOKENS = 4096;

export function getMaxTokensForModel(model: string): number {
  const normalized = model.toLowerCase();
  // Reasoning/thinking models need a much larger completion token budget because
  // their thinking tokens are counted against the max completion tokens limit.
  if (normalized.includes('gpt-5')) {
    return 128000;
  }
  if (normalized.includes('o3-') || normalized.startsWith('o3')) {
    return 100000;
  }
  if (normalized.includes('o1-') || normalized.startsWith('o1')) {
    return 65536;
  }
  return MODEL_MAX_TOKENS[model] ?? DEFAULT_MAX_TOKENS;
}

const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  'gpt-3.5-turbo': 16385,
  'gpt-4': 8192,
  'gpt-4o': 128000,
  'claude-2': 100000,
  'claude-3-opus': 200000,
  'gemini-pro': 128000,
  'codestral/codestral-latest': 32000,
  'deepseek-chat': 64000,
};

export function getContextLimitForModel(model: string): number {
  const normalized = model.toLowerCase();
  if (MODEL_CONTEXT_LIMITS[model]) {
    return MODEL_CONTEXT_LIMITS[model];
  }
  // Keyword matching for unknown models
  if (normalized.includes('gpt-5')) return 400000;
  if (normalized.includes('o1-') || normalized.startsWith('o1')) return 200000;
  if (normalized.includes('o3-') || normalized.startsWith('o3')) return 200000;
  if (normalized.includes('gpt-4o')) return 128000;
  if (normalized.includes('gpt-4')) return 8192;
  if (normalized.includes('gpt-3.5')) return 16385;
  if (normalized.includes('claude-3-5') || normalized.includes('claude-3.5')) return 200000;
  if (normalized.includes('claude-3')) return 200000;
  if (normalized.includes('gemini-1.5') || normalized.includes('gemini-pro')) return 128000;
  if (normalized.includes('llama-3') || normalized.includes('llama3')) return 8192;
  if (normalized.includes('mistral') || normalized.includes('mixtral')) return 32000;
  
  return 8192; // safe default fallback
}

export async function queryLiteLLM(
  messages: ChatMessage[],
  model: string,
  apiKey: string,
  endpoint: string,
  signal?: AbortSignal,
  tools?: any[],
  provider?: string
): Promise<any> {
  const chatProvider = provider || 'litellm';

  const useMaxCompletionTokens =
    model.toLowerCase().includes('o1-') ||
    model.toLowerCase().startsWith('o1') ||
    model.toLowerCase().includes('o3-') ||
    model.toLowerCase().startsWith('o3') ||
    model.toLowerCase().includes('gpt-5');

  let requestBody: Record<string, any>;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (chatProvider === 'ollama') {
    // Ollama uses a different image format: { role, content, images: [base64...] }
    const ollamaMessages = messages.map(m => {
      if (Array.isArray(m.content)) {
        const textParts = m.content.filter((p: any) => p.type === 'text').map((p: any) => p.text);
        const imageParts = m.content.filter((p: any) => p.type === 'image_url').map((p: any) => {
          const url: string = p.image_url.url;
          // Strip data URL prefix to get raw base64
          return url.includes(',') ? url.split(',')[1] : url;
        });
        return {
          role: m.role,
          content: textParts.join('\n'),
          ...(imageParts.length > 0 ? { images: imageParts } : {}),
        };
      }
      return m;
    });
    requestBody = {
      model: model,
      messages: ollamaMessages,
      stream: false,
      options: {
        num_predict: getMaxTokensForModel(model),
      },
    };
    if (tools && tools.length > 0) {
      requestBody.tools = tools;
    }
  } else {
    requestBody = {
      model: model,
      messages: messages,
    };
    if (chatProvider === 'litellm') {
      requestBody.api_key = apiKey;
    }
    if (tools && tools.length > 0) {
      requestBody.tools = tools;
    }
    if (useMaxCompletionTokens) {
      requestBody.max_completion_tokens = getMaxTokensForModel(model);
    } else {
      requestBody.max_tokens = getMaxTokensForModel(model);
    }
    if (apiKey?.trim()) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
    signal,
  });

  if (!response.ok) {
    throw new Error(`LLM request failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  // Normalize Ollama response to OpenAI format
  if (chatProvider === 'ollama' && data.message && !data.choices) {
    return {
      choices: [{
        message: data.message,
      }],
    };
  }

  return data;
}

export async function fetchLiteLLMModels(endpoint: string, apiKey: string): Promise<string[]> {
  let modelsEndpoint = endpoint;
  if (endpoint.endsWith('/chat/completions')) {
    modelsEndpoint = endpoint.replace(/\/chat\/completions$/, '/models');
  } else if (endpoint.endsWith('/chat/completions/')) {
    modelsEndpoint = endpoint.replace(/\/chat\/completions\/$/, '/models');
  } else {
    try {
      const url = new URL(endpoint);
      url.pathname = url.pathname.replace(/\/chat\/completions$/, '/models');
      modelsEndpoint = url.toString();
    } catch {
      modelsEndpoint = endpoint + '/models';
    }
  }

  const response = await fetch(modelsEndpoint, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch models from LiteLLM: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  if (data && Array.isArray(data.data)) {
    return data.data.map((m: any) => m.id);
  }
  throw new Error('Invalid response format from LiteLLM models endpoint');
}

/** Default model lists per provider, used as fallback when dynamic fetching fails. */
export const PROVIDER_DEFAULT_MODELS: Record<string, string[]> = {
  openai: [
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-4',
    'gpt-4-turbo',
    'gpt-3.5-turbo',
    'o1',
    'o1-mini',
    'o3',
    'o3-mini',
    'o4-mini',
  ],
  ollama: [
    'llama3.2',
    'llama3.1',
    'llama3',
    'mistral',
    'mixtral',
    'qwen2.5',
    'qwen2',
    'deepseek-r1',
    'gemma2',
    'phi3',
    'codellama',
  ],
  litellm: [
    'gpt-4o',
    'gpt-4',
    'gpt-3.5-turbo',
    'claude-3-5-sonnet',
    'claude-3-opus',
    'gemini-pro',
    'deepseek-chat',
    'codestral/codestral-latest',
  ],
};

/**
 * Fetch available models from the appropriate endpoint based on provider.
 * - OpenAI: GET /v1/models (filters to chat-capable models)
 * - Ollama: GET /api/tags (local model list)
 * - LiteLLM: GET /models (proxy-registered models)
 *
 * Returns the model list, or throws on failure.
 */
export async function fetchModelsForProvider(
  provider: string,
  endpoint: string,
  apiKey: string
): Promise<string[]> {
  if (provider === 'ollama') {
    return fetchOllamaModels(endpoint);
  }
  if (provider === 'openai') {
    return fetchOpenAIModels(endpoint, apiKey);
  }
  // LiteLLM and any other provider: use the existing OpenAI-compatible /models endpoint
  return fetchLiteLLMModels(endpoint, apiKey);
}

/** Fetch models from an Ollama instance via /api/tags. */
async function fetchOllamaModels(endpoint: string): Promise<string[]> {
  // Derive the tags endpoint from the chat endpoint
  let tagsEndpoint: string;
  try {
    const url = new URL(endpoint);
    url.pathname = '/api/tags';
    tagsEndpoint = url.toString();
  } catch {
    tagsEndpoint = 'http://localhost:11434/api/tags';
  }

  const response = await fetch(tagsEndpoint, { method: 'GET' });
  if (!response.ok) {
    throw new Error(`Failed to fetch models from Ollama: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  if (data && Array.isArray(data.models)) {
    return data.models.map((m: any) => m.name?.replace(/:latest$/, '') || m.name);
  }
  throw new Error('Invalid response format from Ollama /api/tags');
}

/** Fetch models from an OpenAI-compatible /v1/models endpoint, filtering to GPT/chat models. */
async function fetchOpenAIModels(endpoint: string, apiKey: string): Promise<string[]> {
  let modelsEndpoint: string;
  try {
    const url = new URL(endpoint);
    url.pathname = '/v1/models';
    modelsEndpoint = url.toString();
  } catch {
    modelsEndpoint = 'https://api.openai.com/v1/models';
  }

  const response = await fetch(modelsEndpoint, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch models from OpenAI: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  if (data && Array.isArray(data.data)) {
    // Filter to chat-capable models (gpt-*, o1-*, o3-*, o4-*, chatgpt-*)
    const chatModels = data.data
      .map((m: any) => m.id as string)
      .filter((id: string) => /^(gpt-|o[0-9]|chatgpt-)/.test(id))
      .sort();
    return chatModels.length > 0 ? chatModels : data.data.map((m: any) => m.id);
  }
  throw new Error('Invalid response format from OpenAI /v1/models');
}
