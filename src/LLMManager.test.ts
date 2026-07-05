import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { queryLiteLLM } from './LLMManager';

describe('queryLiteLLM', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('sends OpenAI-format request for openai provider', async () => {
    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: 'hi' } }] }),
    });

    await queryLiteLLM(
      [{ role: 'user', content: 'hello' }],
      'gpt-4o', 'sk-key', 'https://api.openai.com/v1/chat/completions',
      undefined, undefined, 'openai'
    );

    const [url, opts] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    const body = JSON.parse(opts.body);
    expect(body.model).toBe('gpt-4o');
    expect(body.messages).toHaveLength(1);
    expect(body.api_key).toBeUndefined(); // OpenAI doesn't send api_key in body
    expect(opts.headers['Authorization']).toBe('Bearer sk-key');
  });

  it('sends api_key in body for litellm provider', async () => {
    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: 'hi' } }] }),
    });

    await queryLiteLLM(
      [{ role: 'user', content: 'hello' }],
      'gpt-4o', 'sk-key', 'http://localhost:4000/chat/completions',
      undefined, undefined, 'litellm'
    );

    const [, opts] = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.api_key).toBe('sk-key');
  });

  it('sends Ollama format and normalizes response', async () => {
    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ message: { role: 'assistant', content: 'ollama response' } }),
    });

    const result = await queryLiteLLM(
      [{ role: 'user', content: 'hello' }],
      'llama3', '', 'http://localhost:11434/api/chat',
      undefined, undefined, 'ollama'
    );

    const [, opts] = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.stream).toBe(false);
    expect(body.options?.num_predict).toBeDefined();
    expect(body.max_tokens).toBeUndefined();
    expect(opts.headers['Authorization']).toBeUndefined();
    // Response normalized to OpenAI format
    expect(result.choices[0].message.content).toBe('ollama response');
  });

  it('does not send Authorization header for ollama', async () => {
    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ message: { role: 'assistant', content: 'hi' } }),
    });

    await queryLiteLLM(
      [{ role: 'user', content: 'hi' }],
      'llama3', '', 'http://localhost:11434/api/chat',
      undefined, undefined, 'ollama'
    );

    const [, opts] = (globalThis.fetch as any).mock.calls[0];
    expect(opts.headers['Authorization']).toBeUndefined();
  });

  it('throws on non-ok response', async () => {
    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    });

    await expect(
      queryLiteLLM([{ role: 'user', content: 'hi' }], 'gpt-4o', 'bad-key', 'http://x', undefined, undefined, 'openai')
    ).rejects.toThrow('LLM request failed: 401 Unauthorized');
  });

  it('includes tools in request body when provided', async () => {
    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: 'hi' } }] }),
    });

    const tools = [{ type: 'function', function: { name: 'test_tool', parameters: {} } }];
    await queryLiteLLM(
      [{ role: 'user', content: 'hi' }],
      'gpt-4o', 'key', 'http://x',
      undefined, tools, 'openai'
    );

    const [, opts] = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.tools).toEqual(tools);
  });

  it('uses max_completion_tokens for o1/o3/gpt-5 models', async () => {
    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: 'hi' } }] }),
    });

    await queryLiteLLM(
      [{ role: 'user', content: 'hi' }],
      'o1-preview', 'key', 'http://x',
      undefined, undefined, 'openai'
    );

    const [, opts] = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.max_completion_tokens).toBeDefined();
    expect(body.max_tokens).toBeUndefined();
  });
});
