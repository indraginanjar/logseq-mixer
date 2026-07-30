import { describe, it, expect, vi, beforeEach } from 'vitest';
import { queryLiteLLM, queryLiteLLMStreaming } from './LLMManager';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
});

describe('reasoning_effort parameter injection', () => {
  describe('queryLiteLLM', () => {
    it('includes reasoning_effort in request body for openai provider', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'test' } }] }),
      });

      await queryLiteLLM(
        [{ role: 'user', content: 'hello' }],
        'gpt-4o',
        'sk-test',
        'https://api.openai.com/v1/chat/completions',
        undefined,
        undefined,
        'openai',
        'medium'
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.reasoning_effort).toBe('medium');
    });

    it('includes reasoning_effort in request body for litellm provider', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'test' } }] }),
      });

      await queryLiteLLM(
        [{ role: 'user', content: 'hello' }],
        'claude-3-opus',
        'sk-test',
        'http://localhost:4000/chat/completions',
        undefined,
        undefined,
        'litellm',
        'xhigh'
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.reasoning_effort).toBe('xhigh');
    });

    it('sets think option for ollama provider based on effort level', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: { role: 'assistant', content: 'test' } }),
      });

      await queryLiteLLM(
        [{ role: 'user', content: 'hello' }],
        'llama3.2',
        '',
        'http://localhost:11434/api/chat',
        undefined,
        undefined,
        'ollama',
        'high'
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.options.think).toBe(true);
    });

    it('omits think option for ollama when effort is low', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: { role: 'assistant', content: 'test' } }),
      });

      await queryLiteLLM(
        [{ role: 'user', content: 'hello' }],
        'llama3.2',
        '',
        'http://localhost:11434/api/chat',
        undefined,
        undefined,
        'ollama',
        'low'
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.options?.think).toBeUndefined();
    });

    it('omits reasoning_effort when not provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'test' } }] }),
      });

      await queryLiteLLM(
        [{ role: 'user', content: 'hello' }],
        'gpt-4o',
        'sk-test',
        'https://api.openai.com/v1/chat/completions',
        undefined,
        undefined,
        'openai'
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.reasoning_effort).toBeUndefined();
    });

    it('omits reasoning_effort when undefined is passed explicitly', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'test' } }] }),
      });

      await queryLiteLLM(
        [{ role: 'user', content: 'hello' }],
        'gpt-4o',
        'sk-test',
        'https://api.openai.com/v1/chat/completions',
        undefined,
        undefined,
        'openai',
        undefined
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.reasoning_effort).toBeUndefined();
    });
  });

  describe('queryLiteLLMStreaming', () => {
    it('includes reasoning_effort in streaming request for openai', async () => {
      // Mock a streaming response
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'));
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: stream,
        headers: new Headers({ 'content-type': 'text/event-stream' }),
      });

      const chunks: string[] = [];
      await queryLiteLLMStreaming(
        [{ role: 'user', content: 'hello' }],
        'gpt-4o',
        'sk-test',
        'https://api.openai.com/v1/chat/completions',
        (chunk) => chunks.push(chunk),
        undefined,
        undefined,
        'openai',
        'max'
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.reasoning_effort).toBe('max');
      expect(body.stream).toBe(true);
    });
  });
});
