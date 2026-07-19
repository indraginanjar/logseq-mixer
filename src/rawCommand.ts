/**
 * /raw command — sends the user's prompt directly to the LLM without
 * RAG context, memory injection, page context, or conversation history.
 * Only the system prompt and the user's raw message are sent.
 */

import { queryLiteLLM, resolveChatEndpoint, type ChatMessage } from './LLMManager';

/**
 * Check if a message is a /raw command.
 */
export function isRawCommand(message: string): boolean {
  const trimmed = message.trim();
  return trimmed.toLowerCase().startsWith('/raw ') || trimmed.toLowerCase() === '/raw';
}

/**
 * Extract the user prompt from a /raw command (everything after "/raw ").
 */
export function extractRawPrompt(message: string): string {
  const trimmed = message.trim();
  if (trimmed.toLowerCase() === '/raw') return '';
  return trimmed.slice(5); // remove "/raw "
}

/**
 * Send a raw prompt to the LLM with only the system prompt — no RAG, memory, or history.
 */
export async function sendRawPrompt(
  userPrompt: string,
  settings: any,
  signal?: AbortSignal
): Promise<string> {
  if (!userPrompt.trim()) {
    return '**Usage:** `/raw <your prompt>`\n\nSends your message directly to the LLM without any RAG context, memory, page context, or conversation history. Only the system prompt is included.';
  }

  const endpoint = resolveChatEndpoint(settings);
  if (!settings.selectedModel || !endpoint) {
    return '⚠️ No model or endpoint configured. Please set up a provider in settings first.';
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: settings.prompt || 'You are a helpful assistant.' },
    { role: 'user', content: userPrompt },
  ];

  const result = await queryLiteLLM(
    messages,
    settings.selectedModel,
    settings.apiKey,
    endpoint,
    signal,
    undefined, // no tools
    settings.chatProvider
  );

  const answer = result.choices?.[0]?.message?.content?.trim();
  if (!answer) {
    throw new Error('No response received from the LLM.');
  }
  return answer;
}
