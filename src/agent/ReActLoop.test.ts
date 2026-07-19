import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock LLMManager
vi.mock('../LLMManager', () => ({
  queryLiteLLM: vi.fn(),
  resolveChatEndpoint: (settings: any) => settings?.chatEndpoint || 'http://localhost:4000/chat/completions',
}));

// Mock MCPManager
vi.mock('../mcp/MCPManager', () => ({
  MCPManager: {
    getInstance: () => ({
      getEnabledTools: () => [],
      executeToolCall: vi.fn(),
    }),
  },
}));

// Mock tokenizer
vi.mock('../tokenizer', () => ({
  countTokens: (text: string) => text.length,
}));

// Mock logseqTools
vi.mock('./logseqTools', () => ({
  LOGSEQ_TOOLS: [],
  executeLogseqTool: vi.fn(),
}));

import { runReActLoop } from './ReActLoop';
import { queryLiteLLM } from '../LLMManager';

const mockQueryLiteLLM = queryLiteLLM as ReturnType<typeof vi.fn>;

describe('ReActLoop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns answer directly when LLM responds without tool calls', async () => {
    mockQueryLiteLLM.mockResolvedValueOnce({
      choices: [{ message: { content: 'Hello, world!', tool_calls: null } }],
    });

    const result = await runReActLoop(
      [{ role: 'user', content: 'hi' }],
      { settings: { selectedModel: 'gpt-4o', apiKey: 'key', chatEndpoint: 'http://x', chatProvider: 'openai' }, signal: undefined, maxIterations: 10, tokenBudget: 0 }
    );

    expect(result.answer).toBe('Hello, world!');
    expect(result.iterations).toBe(0);
    expect(result.toolCalls).toHaveLength(0);
  });

  it('executes tool calls and iterates', async () => {
    // First call: LLM requests a tool call
    mockQueryLiteLLM.mockResolvedValueOnce({
      choices: [{
        message: {
          content: 'Let me search for that',
          tool_calls: [{ id: 'tc1', function: { name: 'logseq_search_pages', arguments: '{"query":"test"}' } }],
        },
      }],
    });
    // Second call: LLM provides final answer
    mockQueryLiteLLM.mockResolvedValueOnce({
      choices: [{ message: { content: 'Found the results.', tool_calls: null } }],
    });

    const { executeLogseqTool } = await import('./logseqTools');
    (executeLogseqTool as any).mockResolvedValueOnce('Page1, Page2');

    const result = await runReActLoop(
      [{ role: 'system', content: 'system' }, { role: 'user', content: 'find pages' }],
      { settings: { selectedModel: 'gpt-4o', apiKey: 'key', chatEndpoint: 'http://x', chatProvider: 'openai' }, signal: undefined, maxIterations: 10, tokenBudget: 0 }
    );

    expect(result.answer).toBe('Found the results.');
    expect(result.iterations).toBe(1);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].tool).toBe('logseq_search_pages');
    expect(result.thoughts).toHaveLength(1);
    expect(result.thoughts[0].thought).toBe('Let me search for that');
  });

  it('stops at maxIterations', async () => {
    // Always return tool calls to force hitting the limit
    mockQueryLiteLLM.mockResolvedValue({
      choices: [{
        message: {
          content: 'thinking',
          tool_calls: [{ id: 'tc', function: { name: 'logseq_search_pages', arguments: '{}' } }],
        },
      }],
    });

    const { executeLogseqTool } = await import('./logseqTools');
    (executeLogseqTool as any).mockResolvedValue('result');

    const result = await runReActLoop(
      [{ role: 'user', content: 'loop forever' }],
      { settings: { selectedModel: 'gpt-4o', apiKey: 'key', chatEndpoint: 'http://x', chatProvider: 'openai' }, signal: undefined, maxIterations: 3, tokenBudget: 0 }
    );

    expect(result.iterations).toBe(3);
  });

  it('stops when signal is aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    mockQueryLiteLLM.mockResolvedValueOnce({
      choices: [{
        message: {
          content: '',
          tool_calls: [{ id: 'tc', function: { name: 'test', arguments: '{}' } }],
        },
      }],
    });

    const result = await runReActLoop(
      [{ role: 'user', content: 'test' }],
      { settings: { selectedModel: 'gpt-4o', apiKey: 'key', chatEndpoint: 'http://x', chatProvider: 'openai' }, signal: controller.signal, maxIterations: 10, tokenBudget: 0 }
    );

    // The loop increments iterations before checking signal, so 1 iteration occurs
    expect(result.iterations).toBe(1);
  });

  it('respects token budget', async () => {
    mockQueryLiteLLM.mockResolvedValueOnce({
      choices: [{
        message: {
          content: 'x'.repeat(500),
          tool_calls: [{ id: 'tc', function: { name: 'test', arguments: '{}' } }],
        },
      }],
    });

    const { executeLogseqTool } = await import('./logseqTools');
    (executeLogseqTool as any).mockResolvedValue('result');

    const result = await runReActLoop(
      [{ role: 'user', content: 'test' }],
      { settings: { selectedModel: 'gpt-4o', apiKey: 'key', chatEndpoint: 'http://x', chatProvider: 'openai' }, signal: undefined, maxIterations: 10, tokenBudget: 100 }
    );

    // Should stop due to budget
    expect(result.iterations).toBeLessThanOrEqual(1);
  });

  it('calls onThought callback when thought is present', async () => {
    mockQueryLiteLLM.mockResolvedValueOnce({
      choices: [{
        message: {
          content: 'I need to think about this',
          tool_calls: [{ id: 'tc', function: { name: 'logseq_search_pages', arguments: '{}' } }],
        },
      }],
    });
    mockQueryLiteLLM.mockResolvedValueOnce({
      choices: [{ message: { content: 'Done.', tool_calls: null } }],
    });

    const { executeLogseqTool } = await import('./logseqTools');
    (executeLogseqTool as any).mockResolvedValue('result');

    const onThought = vi.fn();
    await runReActLoop(
      [{ role: 'user', content: 'test' }],
      { settings: { selectedModel: 'gpt-4o', apiKey: 'key', chatEndpoint: 'http://x', chatProvider: 'openai' }, signal: undefined, maxIterations: 10, tokenBudget: 0, onThought }
    );

    expect(onThought).toHaveBeenCalledWith('I need to think about this', 1);
  });
});
