import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { queryLiteLLM, queryLiteLLMStreaming } from './LLMManager';

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

// --- Helper to create a ReadableStream from SSE text chunks ---
function createMockStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index]));
        index++;
      } else {
        controller.close();
      }
    },
  });
}

function mockStreamingResponse(
  chunks: string[],
  contentType = 'text/event-stream'
): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'content-type': contentType }),
    body: createMockStream(chunks),
  } as unknown as Response;
}

describe('queryLiteLLMStreaming', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // --- Request body construction ---

  it('sends stream:true in request body for openai provider', async () => {
    const resp = mockStreamingResponse([
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n',
    ]);
    (globalThis.fetch as any).mockResolvedValueOnce(resp);

    await queryLiteLLMStreaming(
      [{ role: 'user', content: 'hello' }],
      'gpt-4o', 'sk-key', 'https://api.openai.com/v1/chat/completions',
      () => {}, undefined, undefined, 'openai'
    );

    const [, opts] = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.stream).toBe(true);
    expect(body.max_tokens).toBeDefined();
    expect(opts.headers['Authorization']).toBe('Bearer sk-key');
  });

  it('sends api_key in body for litellm provider', async () => {
    const resp = mockStreamingResponse([
      'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n',
    ]);
    (globalThis.fetch as any).mockResolvedValueOnce(resp);

    await queryLiteLLMStreaming(
      [{ role: 'user', content: 'hi' }],
      'gpt-4o', 'my-key', 'http://localhost:4000/chat/completions',
      () => {}, undefined, undefined, 'litellm'
    );

    const [, opts] = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.api_key).toBe('my-key');
    expect(body.stream).toBe(true);
  });

  it('sends Ollama format with stream:true and num_predict', async () => {
    const resp = mockStreamingResponse(
      ['{"message":{"content":"hi"},"done":false}\n{"message":{"content":"!"},"done":true}\n'],
      'application/x-ndjson'
    );
    (globalThis.fetch as any).mockResolvedValueOnce(resp);

    await queryLiteLLMStreaming(
      [{ role: 'user', content: 'hello' }],
      'llama3', '', 'http://localhost:11434/api/chat',
      () => {}, undefined, undefined, 'ollama'
    );

    const [, opts] = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.stream).toBe(true);
    expect(body.options?.num_predict).toBeDefined();
    expect(body.max_tokens).toBeUndefined();
    expect(opts.headers['Authorization']).toBeUndefined();
  });

  it('uses max_completion_tokens for o1/o3 models', async () => {
    const resp = mockStreamingResponse([
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n',
    ]);
    (globalThis.fetch as any).mockResolvedValueOnce(resp);

    await queryLiteLLMStreaming(
      [{ role: 'user', content: 'hi' }],
      'o3-mini', 'key', 'http://x',
      () => {}, undefined, undefined, 'openai'
    );

    const [, opts] = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.max_completion_tokens).toBeDefined();
    expect(body.max_tokens).toBeUndefined();
  });

  it('includes tools in request body when provided', async () => {
    const resp = mockStreamingResponse([
      'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n',
    ]);
    (globalThis.fetch as any).mockResolvedValueOnce(resp);

    const tools = [{ type: 'function', function: { name: 'search', parameters: {} } }];
    await queryLiteLLMStreaming(
      [{ role: 'user', content: 'hi' }],
      'gpt-4o', 'key', 'http://x',
      () => {}, undefined, tools, 'openai'
    );

    const [, opts] = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.tools).toEqual(tools);
  });

  // --- SSE parsing (OpenAI/LiteLLM format) ---

  it('parses SSE stream and calls onChunk for each delta', async () => {
    const resp = mockStreamingResponse([
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
      'data: [DONE]\n\n',
    ]);
    (globalThis.fetch as any).mockResolvedValueOnce(resp);

    const chunks: string[] = [];
    const result = await queryLiteLLMStreaming(
      [{ role: 'user', content: 'hi' }],
      'gpt-4o', 'key', 'http://x',
      (chunk) => chunks.push(chunk),
      undefined, undefined, 'openai'
    );

    expect(chunks).toEqual(['Hello', ' world']);
    expect(result.choices[0].message.content).toBe('Hello world');
    expect(result.choices[0].message.role).toBe('assistant');
  });

  it('handles multiple SSE events in a single chunk', async () => {
    const resp = mockStreamingResponse([
      'data: {"choices":[{"delta":{"content":"A"}}]}\ndata: {"choices":[{"delta":{"content":"B"}}]}\n\ndata: {"choices":[{"delta":{"content":"C"}}]}\n\ndata: [DONE]\n\n',
    ]);
    (globalThis.fetch as any).mockResolvedValueOnce(resp);

    const chunks: string[] = [];
    const result = await queryLiteLLMStreaming(
      [{ role: 'user', content: 'hi' }],
      'gpt-4o', 'key', 'http://x',
      (chunk) => chunks.push(chunk),
      undefined, undefined, 'openai'
    );

    expect(chunks).toEqual(['A', 'B', 'C']);
    expect(result.choices[0].message.content).toBe('ABC');
  });

  it('skips empty lines and data: [DONE] markers', async () => {
    const resp = mockStreamingResponse([
      '\n\ndata: {"choices":[{"delta":{"content":"x"}}]}\n\n\ndata: [DONE]\n\n',
    ]);
    (globalThis.fetch as any).mockResolvedValueOnce(resp);

    const chunks: string[] = [];
    await queryLiteLLMStreaming(
      [{ role: 'user', content: 'hi' }],
      'gpt-4o', 'key', 'http://x',
      (chunk) => chunks.push(chunk),
      undefined, undefined, 'openai'
    );

    expect(chunks).toEqual(['x']);
  });

  it('skips unparseable JSON lines gracefully', async () => {
    const resp = mockStreamingResponse([
      'data: {"choices":[{"delta":{"content":"ok"}}]}\n',
      ': heartbeat\n',
      'data: {invalid json}\n',
      'data: {"choices":[{"delta":{"content":"!"}}]}\n',
      'data: [DONE]\n\n',
    ]);
    (globalThis.fetch as any).mockResolvedValueOnce(resp);

    const chunks: string[] = [];
    const result = await queryLiteLLMStreaming(
      [{ role: 'user', content: 'hi' }],
      'gpt-4o', 'key', 'http://x',
      (chunk) => chunks.push(chunk),
      undefined, undefined, 'openai'
    );

    expect(chunks).toEqual(['ok', '!']);
    expect(result.choices[0].message.content).toBe('ok!');
  });

  // --- Ollama NDJSON format ---

  it('parses Ollama NDJSON stream correctly', async () => {
    const resp = mockStreamingResponse(
      [
        '{"message":{"content":"Hello"},"done":false}\n',
        '{"message":{"content":" from"},"done":false}\n',
        '{"message":{"content":" Ollama"},"done":true}\n',
      ],
      'application/x-ndjson'
    );
    (globalThis.fetch as any).mockResolvedValueOnce(resp);

    const chunks: string[] = [];
    const result = await queryLiteLLMStreaming(
      [{ role: 'user', content: 'hi' }],
      'llama3', '', 'http://localhost:11434/api/chat',
      (chunk) => chunks.push(chunk),
      undefined, undefined, 'ollama'
    );

    expect(chunks).toEqual(['Hello', ' from', ' Ollama']);
    expect(result.choices[0].message.content).toBe('Hello from Ollama');
  });

  it('handles Ollama messages with empty content', async () => {
    const resp = mockStreamingResponse(
      [
        '{"message":{"content":""},"done":false}\n',
        '{"message":{"content":"hi"},"done":false}\n',
        '{"message":{"content":""},"done":true}\n',
      ],
      'application/x-ndjson'
    );
    (globalThis.fetch as any).mockResolvedValueOnce(resp);

    const chunks: string[] = [];
    const result = await queryLiteLLMStreaming(
      [{ role: 'user', content: 'hi' }],
      'llama3', '', 'http://localhost:11434/api/chat',
      (chunk) => chunks.push(chunk),
      undefined, undefined, 'ollama'
    );

    expect(chunks).toEqual(['hi']);
    expect(result.choices[0].message.content).toBe('hi');
  });

  it('handles Ollama image messages in request body', async () => {
    const resp = mockStreamingResponse(
      ['{"message":{"content":"I see a cat"},"done":true}\n'],
      'application/x-ndjson'
    );
    (globalThis.fetch as any).mockResolvedValueOnce(resp);

    await queryLiteLLMStreaming(
      [{
        role: 'user',
        content: [
          { type: 'text', text: 'what is this?' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,abc123' } },
        ],
      }],
      'llava', '', 'http://localhost:11434/api/chat',
      () => {}, undefined, undefined, 'ollama'
    );

    const [, opts] = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.messages[0].content).toBe('what is this?');
    expect(body.messages[0].images).toEqual(['abc123']);
  });

  // --- Non-streaming fallback ---

  it('falls back to non-streaming JSON when content-type is application/json', async () => {
    const resp = {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve({
        choices: [{ message: { role: 'assistant', content: 'full response' } }],
      }),
    } as unknown as Response;
    (globalThis.fetch as any).mockResolvedValueOnce(resp);

    const chunks: string[] = [];
    const result = await queryLiteLLMStreaming(
      [{ role: 'user', content: 'hi' }],
      'gpt-4o', 'key', 'http://x',
      (chunk) => chunks.push(chunk),
      undefined, undefined, 'openai'
    );

    expect(chunks).toEqual(['full response']);
    expect(result.choices[0].message.content).toBe('full response');
  });

  it('falls back to non-streaming for Ollama JSON (normalizes response)', async () => {
    const resp = {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve({
        message: { role: 'assistant', content: 'ollama fallback' },
      }),
    } as unknown as Response;
    (globalThis.fetch as any).mockResolvedValueOnce(resp);

    const chunks: string[] = [];
    const result = await queryLiteLLMStreaming(
      [{ role: 'user', content: 'hi' }],
      'llama3', '', 'http://localhost:11434/api/chat',
      (chunk) => chunks.push(chunk),
      undefined, undefined, 'ollama'
    );

    expect(chunks).toEqual(['ollama fallback']);
    expect(result.choices[0].message.content).toBe('ollama fallback');
  });

  it('does not call onChunk in fallback if content is empty', async () => {
    const resp = {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve({
        choices: [{ message: { role: 'assistant', content: '' } }],
      }),
    } as unknown as Response;
    (globalThis.fetch as any).mockResolvedValueOnce(resp);

    const chunks: string[] = [];
    await queryLiteLLMStreaming(
      [{ role: 'user', content: 'hi' }],
      'gpt-4o', 'key', 'http://x',
      (chunk) => chunks.push(chunk),
      undefined, undefined, 'openai'
    );

    expect(chunks).toEqual([]);
  });

  // --- Tool call accumulation ---

  it('accumulates tool calls from streamed deltas', async () => {
    const resp = mockStreamingResponse([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"search","arguments":""}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"q\\""}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":": \\"hello\\"}"}}]}}]}\n\n',
      'data: [DONE]\n\n',
    ]);
    (globalThis.fetch as any).mockResolvedValueOnce(resp);

    const result = await queryLiteLLMStreaming(
      [{ role: 'user', content: 'hi' }],
      'gpt-4o', 'key', 'http://x',
      () => {}, undefined, undefined, 'openai'
    );

    expect(result.choices[0].message.tool_calls).toHaveLength(1);
    expect(result.choices[0].message.tool_calls[0]).toEqual({
      id: 'call_1',
      type: 'function',
      function: {
        name: 'search',
        arguments: '{"q": "hello"}',
      },
    });
  });

  it('accumulates multiple tool calls by index', async () => {
    const resp = mockStreamingResponse([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"search","arguments":""}},{"index":1,"id":"call_2","function":{"name":"read","arguments":""}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"q\\":\\"a\\"}"}},{"index":1,"function":{"arguments":"{\\"page\\":\\"b\\"}"}}]}}]}\n\n',
      'data: [DONE]\n\n',
    ]);
    (globalThis.fetch as any).mockResolvedValueOnce(resp);

    const result = await queryLiteLLMStreaming(
      [{ role: 'user', content: 'hi' }],
      'gpt-4o', 'key', 'http://x',
      () => {}, undefined, undefined, 'openai'
    );

    expect(result.choices[0].message.tool_calls).toHaveLength(2);
    expect(result.choices[0].message.tool_calls[0].function.name).toBe('search');
    expect(result.choices[0].message.tool_calls[0].function.arguments).toBe('{"q":"a"}');
    expect(result.choices[0].message.tool_calls[1].function.name).toBe('read');
    expect(result.choices[0].message.tool_calls[1].function.arguments).toBe('{"page":"b"}');
  });

  it('does not include tool_calls in response when none are streamed', async () => {
    const resp = mockStreamingResponse([
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n',
    ]);
    (globalThis.fetch as any).mockResolvedValueOnce(resp);

    const result = await queryLiteLLMStreaming(
      [{ role: 'user', content: 'hi' }],
      'gpt-4o', 'key', 'http://x',
      () => {}, undefined, undefined, 'openai'
    );

    expect(result.choices[0].message.tool_calls).toBeUndefined();
  });

  // --- Buffer management ---

  it('handles incomplete lines split across chunks', async () => {
    // Simulate a JSON payload split across two network chunks
    const resp = mockStreamingResponse([
      'data: {"choices":[{"delta":{"con',
      'tent":"split"}}]}\n\ndata: [DONE]\n\n',
    ]);
    (globalThis.fetch as any).mockResolvedValueOnce(resp);

    const chunks: string[] = [];
    const result = await queryLiteLLMStreaming(
      [{ role: 'user', content: 'hi' }],
      'gpt-4o', 'key', 'http://x',
      (chunk) => chunks.push(chunk),
      undefined, undefined, 'openai'
    );

    expect(chunks).toEqual(['split']);
    expect(result.choices[0].message.content).toBe('split');
  });

  it('handles newline split at chunk boundary', async () => {
    const resp = mockStreamingResponse([
      'data: {"choices":[{"delta":{"content":"A"}}]}\n',
      '\ndata: {"choices":[{"delta":{"content":"B"}}]}\n\ndata: [DONE]\n\n',
    ]);
    (globalThis.fetch as any).mockResolvedValueOnce(resp);

    const chunks: string[] = [];
    const result = await queryLiteLLMStreaming(
      [{ role: 'user', content: 'hi' }],
      'gpt-4o', 'key', 'http://x',
      (chunk) => chunks.push(chunk),
      undefined, undefined, 'openai'
    );

    expect(chunks).toEqual(['A', 'B']);
    expect(result.choices[0].message.content).toBe('AB');
  });

  // --- Error handling ---

  it('throws on non-ok response', async () => {
    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      headers: new Headers(),
    });

    await expect(
      queryLiteLLMStreaming(
        [{ role: 'user', content: 'hi' }],
        'gpt-4o', 'key', 'http://x',
        () => {}, undefined, undefined, 'openai'
      )
    ).rejects.toThrow('LLM streaming request failed: 500 Internal Server Error');
  });

  it('throws when response body is not readable', async () => {
    const resp = {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'text/event-stream' }),
      body: null,
    } as unknown as Response;
    (globalThis.fetch as any).mockResolvedValueOnce(resp);

    await expect(
      queryLiteLLMStreaming(
        [{ role: 'user', content: 'hi' }],
        'gpt-4o', 'key', 'http://x',
        () => {}, undefined, undefined, 'openai'
      )
    ).rejects.toThrow('Response body is not readable');
  });

  // --- Abort signal ---

  it('passes abort signal to fetch', async () => {
    const resp = mockStreamingResponse([
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n',
    ]);
    (globalThis.fetch as any).mockResolvedValueOnce(resp);

    const controller = new AbortController();
    await queryLiteLLMStreaming(
      [{ role: 'user', content: 'hi' }],
      'gpt-4o', 'key', 'http://x',
      () => {}, controller.signal, undefined, 'openai'
    );

    const [, opts] = (globalThis.fetch as any).mock.calls[0];
    expect(opts.signal).toBe(controller.signal);
  });

  it('rejects when abort signal is triggered during fetch', async () => {
    const controller = new AbortController();
    (globalThis.fetch as any).mockImplementationOnce(() => {
      controller.abort();
      return Promise.reject(new DOMException('The operation was aborted.', 'AbortError'));
    });

    await expect(
      queryLiteLLMStreaming(
        [{ role: 'user', content: 'hi' }],
        'gpt-4o', 'key', 'http://x',
        () => {}, controller.signal, undefined, 'openai'
      )
    ).rejects.toThrow('aborted');
  });

  // --- Reader cleanup ---

  it('releases reader lock after stream completes', async () => {
    const releaseLock = vi.fn();
    const mockReader = {
      read: vi.fn()
        .mockResolvedValueOnce({
          done: false,
          value: new TextEncoder().encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'),
        })
        .mockResolvedValueOnce({ done: true, value: undefined }),
      releaseLock,
    };
    const resp = {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'text/event-stream' }),
      body: { getReader: () => mockReader },
    } as unknown as Response;
    (globalThis.fetch as any).mockResolvedValueOnce(resp);

    await queryLiteLLMStreaming(
      [{ role: 'user', content: 'hi' }],
      'gpt-4o', 'key', 'http://x',
      () => {}, undefined, undefined, 'openai'
    );

    expect(releaseLock).toHaveBeenCalledTimes(1);
  });

  it('releases reader lock even when an error occurs during reading', async () => {
    const releaseLock = vi.fn();
    const mockReader = {
      read: vi.fn().mockRejectedValueOnce(new Error('network error')),
      releaseLock,
    };
    const resp = {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'text/event-stream' }),
      body: { getReader: () => mockReader },
    } as unknown as Response;
    (globalThis.fetch as any).mockResolvedValueOnce(resp);

    await expect(
      queryLiteLLMStreaming(
        [{ role: 'user', content: 'hi' }],
        'gpt-4o', 'key', 'http://x',
        () => {}, undefined, undefined, 'openai'
      )
    ).rejects.toThrow('network error');

    expect(releaseLock).toHaveBeenCalledTimes(1);
  });

  // --- Content-type detection for ndjson ---

  it('recognizes ndjson content-type as streaming', async () => {
    const resp = mockStreamingResponse(
      ['{"message":{"content":"ndjson"},"done":true}\n'],
      'application/ndjson'
    );
    (globalThis.fetch as any).mockResolvedValueOnce(resp);

    const chunks: string[] = [];
    const result = await queryLiteLLMStreaming(
      [{ role: 'user', content: 'hi' }],
      'llama3', '', 'http://localhost:11434/api/chat',
      (chunk) => chunks.push(chunk),
      undefined, undefined, 'ollama'
    );

    expect(chunks).toEqual(['ndjson']);
    expect(result.choices[0].message.content).toBe('ndjson');
  });
});
