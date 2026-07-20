import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock LLMManager
vi.mock('../LLMManager', () => ({
  queryLiteLLM: vi.fn(),
  getContextLimitForModel: () => 100000,
  resolveChatEndpoint: (settings: any) => settings?.chatEndpoint || 'http://localhost:4000/chat/completions',
}));

// Mock ReActLoop
vi.mock('./ReActLoop', () => ({
  runReActLoop: vi.fn().mockResolvedValue({ answer: 'done', thoughts: [], toolCalls: [], tokensUsed: 50, iterations: 0 }),
}));

// Mock tokenizer
vi.mock('../tokenizer', () => ({
  countTokens: (text: string) => text.length,
  encode: (text: string) => new Uint32Array(text.split('').map((c: string) => c.charCodeAt(0))),
  decode: (arr: Uint32Array) => String.fromCharCode(...arr),
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

// Mock logseqTools
vi.mock('./logseqTools', () => ({
  LOGSEQ_TOOLS: [],
  executeLogseqTool: vi.fn(),
}));

// Mock blockExecutor
vi.mock('../blockExecutor', () => ({
  executeOne: vi.fn(),
}));

// Mock diagramIntentDetector
vi.mock('../utils/diagramIntentDetector', () => ({
  isDiagramIntent: () => false,
  DIAGRAM_RULES: '',
}));

import { queryLiteLLM } from '../LLMManager';
import { AgentLoop } from './AgentLoop';

const mockQueryLiteLLM = queryLiteLLM as ReturnType<typeof vi.fn>;

function createMockMemoryStore() {
  return {
    searchMemories: vi.fn().mockReturnValue([]),
    addMemoryIfUnique: vi.fn().mockReturnValue('mem-id'),
    addMemory: vi.fn().mockReturnValue('mem-id'),
    getRecentMemories: vi.fn().mockReturnValue([]),
    getMemoryCount: vi.fn().mockReturnValue(0),
  };
}

describe('AgentLoop memory integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: generatePlan returns a plan with one think step, executeStep returns output
    mockQueryLiteLLM.mockResolvedValue({
      choices: [{ message: { content: '{"steps":[{"id":1,"description":"analyze the goal","type":"think"}],"estimatedTokens":1000}' } }],
    });
  });

  it('recalls memories at start of run when available', async () => {
    const memoryStore = createMockMemoryStore();
    memoryStore.searchMemories.mockReturnValue([
      { id: '1', category: 'agent_observation', content: 'User has ML notes', createdAt: Date.now(), lastAccessed: null, source: null, metadata: null },
    ]);

    // First call: generatePlan, Second call: executeStep (think), Third call: synthesize
    mockQueryLiteLLM
      .mockResolvedValueOnce({ choices: [{ message: { content: '{"steps":[{"id":1,"description":"analyze","type":"think"}],"estimatedTokens":1000}' } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: 'Analysis complete with sufficient length to trigger storage.' } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: 'Final synthesized answer from all steps combined.' } }] });

    const loop = new AgentLoop({
      settings: { selectedModel: 'gpt-4o', agentMemoryEnabled: true, chatEndpoint: 'http://x', chatProvider: 'openai', apiKey: 'k' },
      tokenBudget: 500000,
      maxRetries: 0,
      canWrite: false,
      memoryStore: memoryStore as any,
      onProgress: vi.fn(),
      onEscalate: vi.fn().mockResolvedValue('skip'),
      onReplanProposed: vi.fn().mockResolvedValue(false),
    });

    const plan = await loop.generatePlan('test goal', '');
    await loop.run(plan);

    expect(memoryStore.searchMemories).toHaveBeenCalled();
  });

  it('does not recall when agentMemoryEnabled is false', async () => {
    const memoryStore = createMockMemoryStore();

    mockQueryLiteLLM
      .mockResolvedValueOnce({ choices: [{ message: { content: '{"steps":[{"id":1,"description":"analyze","type":"think"}],"estimatedTokens":1000}' } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: 'Analysis result text.' } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: 'Synthesis result.' } }] });

    const loop = new AgentLoop({
      settings: { selectedModel: 'gpt-4o', agentMemoryEnabled: false, chatEndpoint: 'http://x', chatProvider: 'openai', apiKey: 'k' },
      tokenBudget: 500000,
      maxRetries: 0,
      canWrite: false,
      memoryStore: memoryStore as any,
      onProgress: vi.fn(),
      onEscalate: vi.fn().mockResolvedValue('skip'),
      onReplanProposed: vi.fn().mockResolvedValue(false),
    });

    const plan = await loop.generatePlan('test goal', '');
    await loop.run(plan);

    expect(memoryStore.searchMemories).not.toHaveBeenCalled();
  });

  it('does not store memory when memoryReadOnly is true', async () => {
    const memoryStore = createMockMemoryStore();

    mockQueryLiteLLM
      .mockResolvedValueOnce({ choices: [{ message: { content: '{"steps":[{"id":1,"description":"analyze","type":"think"}],"estimatedTokens":1000}' } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: 'Analysis result text that is long enough to be stored as memory.' } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: 'Synthesis result text that is long enough.' } }] });

    const loop = new AgentLoop({
      settings: { selectedModel: 'gpt-4o', agentMemoryEnabled: true, chatEndpoint: 'http://x', chatProvider: 'openai', apiKey: 'k' },
      tokenBudget: 500000,
      maxRetries: 0,
      canWrite: false,
      memoryStore: memoryStore as any,
      memoryReadOnly: true,
      onProgress: vi.fn(),
      onEscalate: vi.fn().mockResolvedValue('skip'),
      onReplanProposed: vi.fn().mockResolvedValue(false),
    });

    const plan = await loop.generatePlan('test goal', '');
    await loop.run(plan);

    expect(memoryStore.addMemoryIfUnique).not.toHaveBeenCalled();
  });

  it('does not store memory when no memoryStore provided', async () => {
    mockQueryLiteLLM
      .mockResolvedValueOnce({ choices: [{ message: { content: '{"steps":[{"id":1,"description":"analyze","type":"think"}],"estimatedTokens":1000}' } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: 'Analysis result.' } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: 'Final synthesis.' } }] });

    const loop = new AgentLoop({
      settings: { selectedModel: 'gpt-4o', agentMemoryEnabled: true, chatEndpoint: 'http://x', chatProvider: 'openai', apiKey: 'k' },
      tokenBudget: 500000,
      maxRetries: 0,
      canWrite: false,
      onProgress: vi.fn(),
      onEscalate: vi.fn().mockResolvedValue('skip'),
      onReplanProposed: vi.fn().mockResolvedValue(false),
    });

    // Should not throw
    const plan = await loop.generatePlan('test goal', '');
    await loop.run(plan);
  });

  it('stores memory after successful run when output is long enough', async () => {
    const memoryStore = createMockMemoryStore();
    const longOutput = 'This is a sufficiently long output that exceeds the 20-character threshold for memory storage and also exceeds 100 characters total for synthesis.';

    // Reset mock completely and set up fresh
    mockQueryLiteLLM.mockReset();
    mockQueryLiteLLM
      .mockResolvedValueOnce({ choices: [{ message: { content: '{"steps":[{"id":1,"description":"analyze","type":"think"}],"estimatedTokens":1000}' } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: longOutput } }] })
      .mockResolvedValue({ choices: [{ message: { content: longOutput } }] });

    const progressEvents: any[] = [];
    const loop = new AgentLoop({
      settings: { selectedModel: 'gpt-4o', agentMemoryEnabled: true, chatEndpoint: 'http://x', chatProvider: 'openai', apiKey: 'k' },
      tokenBudget: 500000,
      maxRetries: 0,
      canWrite: false,
      memoryStore: memoryStore as any,
      onProgress: (ev: any) => progressEvents.push(ev),
      onEscalate: vi.fn().mockResolvedValue('skip'),
      onReplanProposed: vi.fn().mockResolvedValue(false),
    });

    const plan = await loop.generatePlan('test goal for memory', '');
    await loop.run(plan);

    // Check if the plan step was completed
    const doneSteps = plan.steps.filter(s => s.status === 'done');
    expect(doneSteps.length).toBeGreaterThan(0);
    expect(doneSteps[0]!.output!.length).toBeGreaterThan(20);

    // Memory should have been stored
    expect(memoryStore.addMemoryIfUnique).toHaveBeenCalledWith(
      'agent_observation',
      expect.any(String),
      expect.any(String),
    );
  });

  it('executeRecallStep returns formatted memories', async () => {
    const memoryStore = createMockMemoryStore();
    memoryStore.searchMemories.mockReturnValue([
      { id: '1', category: 'fact', content: 'User prefers TypeScript', createdAt: Date.now(), lastAccessed: null, source: null, metadata: null },
      { id: '2', category: 'preference', content: 'Dark mode preferred', createdAt: Date.now(), lastAccessed: null, source: null, metadata: null },
    ]);

    const loop = new AgentLoop({
      settings: { selectedModel: 'gpt-4o', agentMemoryEnabled: true, chatEndpoint: 'http://x', chatProvider: 'openai', apiKey: 'k' },
      tokenBudget: 500000,
      maxRetries: 0,
      canWrite: false,
      memoryStore: memoryStore as any,
      onProgress: vi.fn(),
      onEscalate: vi.fn().mockResolvedValue('skip'),
      onReplanProposed: vi.fn().mockResolvedValue(false),
    });

    // Access private method via reflection
    const executeRecallStep = (loop as any).executeRecallStep.bind(loop);
    const result = await executeRecallStep(
      { id: 1, description: 'recall user preferences', type: 'recall', status: 'running' },
      { previousOutputs: [], createdBlockUUIDs: [], createdPages: [], goal: 'test', scratchPad: new Map() },
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain('Recalled 2 memories');
    expect(result.output).toContain('[fact] User prefers TypeScript');
    expect(result.output).toContain('[preference] Dark mode preferred');
  });

  it('executeRecallStep returns empty message when no memories found', async () => {
    const memoryStore = createMockMemoryStore();
    memoryStore.searchMemories.mockReturnValue([]);

    const loop = new AgentLoop({
      settings: { selectedModel: 'gpt-4o', agentMemoryEnabled: true, chatEndpoint: 'http://x', chatProvider: 'openai', apiKey: 'k' },
      tokenBudget: 500000,
      maxRetries: 0,
      canWrite: false,
      memoryStore: memoryStore as any,
      onProgress: vi.fn(),
      onEscalate: vi.fn().mockResolvedValue('skip'),
      onReplanProposed: vi.fn().mockResolvedValue(false),
    });

    const executeRecallStep = (loop as any).executeRecallStep.bind(loop);
    const result = await executeRecallStep(
      { id: 1, description: 'recall something', type: 'recall', status: 'running' },
      { previousOutputs: [], createdBlockUUIDs: [], createdPages: [], goal: 'test', scratchPad: new Map() },
    );

    expect(result.success).toBe(true);
    expect(result.output).toBe('(No relevant memories found)');
  });

  it('executeRecallStep returns no-store message when memoryStore is absent', async () => {
    const loop = new AgentLoop({
      settings: { selectedModel: 'gpt-4o', agentMemoryEnabled: true, chatEndpoint: 'http://x', chatProvider: 'openai', apiKey: 'k' },
      tokenBudget: 500000,
      maxRetries: 0,
      canWrite: false,
      onProgress: vi.fn(),
      onEscalate: vi.fn().mockResolvedValue('skip'),
      onReplanProposed: vi.fn().mockResolvedValue(false),
    });

    const executeRecallStep = (loop as any).executeRecallStep.bind(loop);
    const result = await executeRecallStep(
      { id: 1, description: 'recall something', type: 'recall', status: 'running' },
      { previousOutputs: [], createdBlockUUIDs: [], createdPages: [], goal: 'test', scratchPad: new Map() },
    );

    expect(result.success).toBe(true);
    expect(result.output).toBe('(No memory store available)');
  });
});
