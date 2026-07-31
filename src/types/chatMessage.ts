/**
 * Canonical location for chat message types.
 * 
 * UIChatMessage — used by React components for rendering messages in the UI.
 * LLMMessage — used by the LLM API layer for request/response payloads.
 */

/** UI-layer message displayed in the chat panel. */
export type UIChatMessage = {
  id: string | number;
  content: string;
  sender: 'user' | 'assistant';
  model?: string;
  timestamp?: string;
  completedTimestamp?: string;
  image?: { name: string; content: string }[];
  file?: { name: string; content: string }[];
};

/** Multimodal content part for LLM messages. */
export type MessageContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

/** LLM API message used in chat completion requests. */
export type LLMMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | MessageContentPart[];
  name?: string;
  tool_call_id?: string;
  tool_calls?: any[];
};
