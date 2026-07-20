import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock LLMManager
vi.mock('../LLMManager', () => ({
  queryLiteLLM: vi.fn(),
  getContextLimitForModel: () => 100000,
  resolveChatEndpoint: (settings: any) => settings?.chatEndpoint || 'http://localhost:4000/chat/completions',
}));

// Mock ReActLoop
vi.mock('./ReActLoop', () => ({
  runReActLoop: vi.fn(),
}));

// Mock tokenizer
vi.mock('../tokenizer', () => ({
  countTokens: (text: string) => text.length,
  encode: (text: string) => new Uint32Array(text.split('').map(c => c.charCodeAt(0))),
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
import { runReActLoop } from './ReActLoop';
import { AgentLoop } from './AgentLoop';
import type { AgentStep, StepContext } from './types';

const mockQueryLiteLLM = queryLiteLLM as ReturnType<typeof vi.fn>;
const mockRunReActLoop = runReActLoop as ReturnType<typeof vi.fn>;

// Helper to access the private method via reflection
function getExecuteSpecialistStep(agentLoop: AgentLoop): (step: AgentStep, context: StepContext) => Promise<any> {
  return (agentLoop as any).executeSpecialistStep.bind(agentLoop);
}

function createAgentLoop(overrides: Partial<{ tokenBudget: number; tokensUsed: number }> = {}): AgentLoop {
  const settings = {
    selectedModel: 'gpt-4o',
    apiKey: 'test-key',
    chatEndpoint: 'http://localhost:4000/chat/completions',
    chatProvider: 'openai',
  };

  const loop = new AgentLoop({
    settings,
    tokenBudget: overrides.tokenBudget ?? 50000,
    maxRetries: 2,
    canWrite: true,
    onProgress: () => {},
    onEscalate: async () => '',
    onReplanProposed: async () => false,
    signal: undefined,
  });

  // Override internal state if needed
  if (overrides.tokensUsed !== undefined) {
    (loop as any).tokensUsed = overrides.tokensUsed;
  }

  return loop;
}

function createContext(): StepContext {
  return {
    previousOutputs: [
      { stepId: 1, type: 'text', content: 'Output from step 1' },
      { stepId: 2, type: 'text', content: 'Output from step 2' },
    ],
    createdBlockUUIDs: [],
    createdPages: [],
    goal: 'Test goal',
    scratchPad: new Map(),
  };
}

function createStep(overrides: Partial<AgentStep> = {}): AgentStep {
  return {
    id: 3,
    description: 'Synthesize findings',
    type: 'specialist',
    status: 'running',
    inputSteps: [1, 2],
    ...overrides,
  };
}

describe('executeSpecialistStep — specialistTools branching', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls queryLiteLLM directly when specialistTools is "none"', async () => {
    mockQueryLiteLLM.mockResolvedValueOnce({
      choices: [{ message: { content: 'Synthesized output' } }],
    });

    const loop = createAgentLoop();
    const executeSpecialist = getExecuteSpecialistStep(loop);
    const step = createStep({ specialistTools: 'none' });
    const context = createContext();

    const result = await executeSpecialist(step, context);

    expect(mockQueryLiteLLM).toHaveBeenCalledTimes(1);
    expect(mockRunReActLoop).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.output).toBe('Synthesized output');
  });

  it('calls runReActLoop with includeLogseqWriteTools=false when specialistTools is "read-only"', async () => {
    mockRunReActLoop.mockResolvedValueOnce({
      answer: 'ReAct answer',
      thoughts: [],
      toolCalls: [],
      tokensUsed: 500,
      iterations: 2,
    });

    const loop = createAgentLoop();
    const executeSpecialist = getExecuteSpecialistStep(loop);
    const step = createStep({ specialistTools: 'read-only' });
    const context = createContext();

    const result = await executeSpecialist(step, context);

    expect(mockRunReActLoop).toHaveBeenCalledTimes(1);
    expect(mockQueryLiteLLM).not.toHaveBeenCalled();

    const callArgs = mockRunReActLoop.mock.calls[0];
    const opts = callArgs[1];
    expect(opts.includeLogseqTools).toBe(true);
    expect(opts.includeLogseqWriteTools).toBe(false);
    expect(opts.maxIterations).toBe(5);

    expect(result.success).toBe(true);
    expect(result.output).toBe('ReAct answer');
  });

  it('defaults to ReAct loop (read-only) when specialistTools is undefined', async () => {
    mockRunReActLoop.mockResolvedValueOnce({
      answer: 'Default ReAct answer',
      thoughts: [],
      toolCalls: [],
      tokensUsed: 300,
      iterations: 1,
    });

    const loop = createAgentLoop();
    const executeSpecialist = getExecuteSpecialistStep(loop);
    const step = createStep(); // no specialistTools set
    const context = createContext();

    const result = await executeSpecialist(step, context);

    expect(mockRunReActLoop).toHaveBeenCalledTimes(1);
    expect(mockQueryLiteLLM).not.toHaveBeenCalled();

    const callArgs = mockRunReActLoop.mock.calls[0];
    const opts = callArgs[1];
    expect(opts.includeLogseqTools).toBe(true);
    expect(opts.includeLogseqWriteTools).toBe(false); // default is read-only, not full
    expect(opts.maxIterations).toBe(5);

    expect(result.success).toBe(true);
    expect(result.output).toBe('Default ReAct answer');
  });

  it('calls runReActLoop with includeLogseqWriteTools=true when specialistTools is "full"', async () => {
    mockRunReActLoop.mockResolvedValueOnce({
      answer: 'Full access answer',
      thoughts: [],
      toolCalls: [{ iteration: 1, tool: 'logseq_insert_block', args: {}, result: 'Block created' }],
      tokensUsed: 800,
      iterations: 3,
    });

    const loop = createAgentLoop();
    const executeSpecialist = getExecuteSpecialistStep(loop);
    const step = createStep({ specialistTools: 'full' });
    const context = createContext();

    const result = await executeSpecialist(step, context);

    expect(mockRunReActLoop).toHaveBeenCalledTimes(1);
    const callArgs = mockRunReActLoop.mock.calls[0];
    const opts = callArgs[1];
    expect(opts.includeLogseqWriteTools).toBe(true);

    expect(result.success).toBe(true);
    // Should include tool results summary
    expect(result.output).toContain('Full access answer');
    expect(result.output).toContain('Tool Results');
    expect(result.output).toContain('logseq_insert_block');
  });

  it('passes correct token budget to ReAct loop', async () => {
    mockRunReActLoop.mockResolvedValueOnce({
      answer: 'Budget test',
      thoughts: [],
      toolCalls: [],
      tokensUsed: 100,
      iterations: 1,
    });

    const loop = createAgentLoop({ tokenBudget: 50000, tokensUsed: 30000 });
    const executeSpecialist = getExecuteSpecialistStep(loop);
    const step = createStep({ specialistTools: 'read-only' });
    const context = createContext();

    await executeSpecialist(step, context);

    const callArgs = mockRunReActLoop.mock.calls[0];
    const opts = callArgs[1];
    // tokenBudget=50000, tokensUsed=30000 → remaining = 20000
    expect(opts.tokenBudget).toBe(20000);
  });

  it('passes tokenBudget=0 when total budget is 0 (unlimited)', async () => {
    mockRunReActLoop.mockResolvedValueOnce({
      answer: 'Unlimited budget test',
      thoughts: [],
      toolCalls: [],
      tokensUsed: 100,
      iterations: 1,
    });

    const loop = createAgentLoop({ tokenBudget: 0, tokensUsed: 5000 });
    const executeSpecialist = getExecuteSpecialistStep(loop);
    const step = createStep({ specialistTools: 'read-only' });
    const context = createContext();

    await executeSpecialist(step, context);

    const callArgs = mockRunReActLoop.mock.calls[0];
    const opts = callArgs[1];
    // tokenBudget=0 means unlimited, so remainingBudget should be 0
    expect(opts.tokenBudget).toBe(0);
  });

  it('stores output in scratchPad for downstream use', async () => {
    mockRunReActLoop.mockResolvedValueOnce({
      answer: 'Cached output',
      thoughts: [],
      toolCalls: [],
      tokensUsed: 200,
      iterations: 1,
    });

    const loop = createAgentLoop();
    const executeSpecialist = getExecuteSpecialistStep(loop);
    const step = createStep({ id: 7 });
    const context = createContext();

    await executeSpecialist(step, context);

    expect(context.scratchPad.get('specialist_step_7')).toContain('Cached output');
  });
});
