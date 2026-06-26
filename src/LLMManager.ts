
export type MessageContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

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
  tools?: any[]
): Promise<any> {
  const useMaxCompletionTokens = 
    model.toLowerCase().includes('o1-') || 
    model.toLowerCase().startsWith('o1') ||
    model.toLowerCase().includes('o3-') || 
    model.toLowerCase().startsWith('o3') ||
    model.toLowerCase().includes('gpt-5');

  const requestBody: Record<string, any> = {
    model: model,
    messages: messages,
    "api_key": apiKey
  };

  if (tools && tools.length > 0) {
    requestBody.tools = tools;
  }

  if (useMaxCompletionTokens) {
    requestBody.max_completion_tokens = getMaxTokensForModel(model);
  } else {
    requestBody.max_tokens = getMaxTokensForModel(model);
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
    signal,
  });

  if (!response.ok) {
    throw new Error(`LiteLLM request failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
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
