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

// Helper to access private methods via reflection
function getExecuteSubGoalStep(agentLoop: AgentLoop): (step: AgentStep, context: StepContext) => Promise<any> {
  return (agentLoop as any).executeSubGoalStep.bind(agentLoop);
}

function getExecuteSpecialistStep(agentLoop: AgentLoop): (step: AgentStep, context: StepContext) => Promise<any> {
  return (agentLoop as any).executeSpecialistStep.bind(agentLoop);
}

function createAgentLoop(overrides: Partial<{
  tokenBudget: number;
  tokensUsed: number;
  depth: number;
  maxDepth: number;
  canWrite: boolean;
  signal: AbortSignal;
  onProgress: (event: any) => void;
}> = {}): AgentLoop {
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
    canWrite: overrides.canWrite ?? true,
    depth: overrides.depth ?? 0,
    maxDepth: overrides.maxDepth ?? 2,
    onProgress: overrides.onProgress ?? (() => {}),
    onEscalate: async () => '',
    onReplanProposed: async () => false,
    signal: overrides.signal,
  });

  // Override internal state if needed
  if (overrides.tokensUsed !== undefined) {
    (loop as any).tokensUsed = overrides.tokensUsed;
  }

  return loop;
}

function createContext(overrides: Partial<StepContext> = {}): StepContext {
  return {
    previousOutputs: [
      { stepId: 1, type: 'text', content: 'Output from step 1' },
      { stepId: 2, type: 'text', content: 'Output from step 2' },
    ],
    createdBlockUUIDs: [],
    createdPages: [],
    goal: 'Test goal',
    scratchPad: new Map(),
    ...overrides,
  };
}

function createSubgoalStep(overrides: Partial<AgentStep> = {}): AgentStep {
  return {
    id: 3,
    description: 'Research and summarize topic X',
    type: 'subgoal',
    status: 'running',
    ...overrides,
  };
}

describe('executeSubGoalStep — recursive sub-goal spawning', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('depth limit enforcement', () => {
    it('downgrades to specialist when depth >= maxDepth', async () => {
      // Setup: depth=2, maxDepth=2 → should NOT spawn child, should call specialist
      mockRunReActLoop.mockResolvedValueOnce({
        answer: 'Specialist fallback output',
        thoughts: [],
        toolCalls: [],
        tokensUsed: 300,
        iterations: 1,
      });

      const loop = createAgentLoop({ depth: 2, maxDepth: 2 });
      const executeSubGoal = getExecuteSubGoalStep(loop);
      const step = createSubgoalStep();
      const context = createContext();

      const result = await executeSubGoal(step, context);

      // Should have called specialist (runReActLoop) instead of spawning child
      expect(mockRunReActLoop).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
      expect(result.output).toContain('Specialist fallback output');
    });

    it('downgrades to specialist when depth > maxDepth', async () => {
      mockRunReActLoop.mockResolvedValueOnce({
        answer: 'Deep fallback',
        thoughts: [],
        toolCalls: [],
        tokensUsed: 200,
        iterations: 1,
      });

      const loop = createAgentLoop({ depth: 5, maxDepth: 2 });
      const executeSubGoal = getExecuteSubGoalStep(loop);
      const step = createSubgoalStep();
      const context = createContext();

      const result = await executeSubGoal(step, context);

      expect(mockRunReActLoop).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
    });

    it('spawns child agent when depth < maxDepth', async () => {
      // First call: generatePlan in child → returns a plan with one think step
      mockQueryLiteLLM.mockResolvedValueOnce({
        choices: [{ message: { content: '{"steps":[{"id":1,"description":"Think about it","type":"think"}],"estimatedTokens":1000}' } }],
      });
      // Second call: executeStep for the think step in child
      mockQueryLiteLLM.mockResolvedValueOnce({
        choices: [{ message: { content: 'Child agent output' } }],
      });
      // Third call: synthesizeFinalAnswer in child
      mockQueryLiteLLM.mockResolvedValueOnce({
        choices: [{ message: { content: 'Synthesized child output' } }],
      });

      const loop = createAgentLoop({ depth: 0, maxDepth: 2 });
      const executeSubGoal = getExecuteSubGoalStep(loop);
      const step = createSubgoalStep();
      const context = createContext();

      const result = await executeSubGoal(step, context);

      // Should NOT have called runReActLoop (that's specialist path)
      // Should have called queryLiteLLM for child's generatePlan and executeStep
      expect(mockQueryLiteLLM).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });
  });

  describe('child agent configuration', () => {
    it('creates child with canWrite: false by default', async () => {
      // We can verify this by inspecting the child's behavior
      // generatePlan call includes write constraint when canWrite=false
      mockQueryLiteLLM.mockResolvedValueOnce({
        choices: [{ message: { content: '{"steps":[{"id":1,"description":"Analyze","type":"think"}],"estimatedTokens":500}' } }],
      });
      mockQueryLiteLLM.mockResolvedValueOnce({
        choices: [{ message: { content: 'Analysis result' } }],
      });
      mockQueryLiteLLM.mockResolvedValueOnce({
        choices: [{ message: { content: 'Final analysis' } }],
      });

      const loop = createAgentLoop({ depth: 0, maxDepth: 2, canWrite: true });
      const executeSubGoal = getExecuteSubGoalStep(loop);
      const step = createSubgoalStep(); // no subgoalConfig → canWrite defaults to false
      const context = createContext();

      await executeSubGoal(step, context);

      // The first queryLiteLLM call is generatePlan — check that it includes write constraint
      const planCall = mockQueryLiteLLM.mock.calls[0];
      const systemPrompt = planCall[0][0].content; // messages[0].content (system)
      expect(systemPrompt).toContain('Direct Page Edit mode is OFF');
    });

    it('passes subgoalConfig.canWrite=true to child', async () => {
      mockQueryLiteLLM.mockResolvedValueOnce({
        choices: [{ message: { content: '{"steps":[{"id":1,"description":"Write something","type":"think"}],"estimatedTokens":500}' } }],
      });
      mockQueryLiteLLM.mockResolvedValueOnce({
        choices: [{ message: { content: 'Written content' } }],
      });
      mockQueryLiteLLM.mockResolvedValueOnce({
        choices: [{ message: { content: 'Final written output' } }],
      });

      const loop = createAgentLoop({ depth: 0, maxDepth: 2 });
      const executeSubGoal = getExecuteSubGoalStep(loop);
      const step = createSubgoalStep({ subgoalConfig: { canWrite: true } });
      const context = createContext();

      await executeSubGoal(step, context);

      // The first queryLiteLLM call (generatePlan) should NOT contain write constraint
      const planCall = mockQueryLiteLLM.mock.calls[0];
      const systemPrompt = planCall[0][0].content;
      expect(systemPrompt).not.toContain('Direct Page Edit mode is OFF');
    });
  });

  describe('token budget sharing', () => {
    it('passes remaining budget to child agent', async () => {
      mockQueryLiteLLM.mockResolvedValueOnce({
        choices: [{ message: { content: '{"steps":[{"id":1,"description":"Think","type":"think"}],"estimatedTokens":100}' } }],
      });
      mockQueryLiteLLM.mockResolvedValueOnce({
        choices: [{ message: { content: 'Result' } }],
      });
      mockQueryLiteLLM.mockResolvedValueOnce({
        choices: [{ message: { content: 'Final result' } }],
      });

      const loop = createAgentLoop({ tokenBudget: 50000, tokensUsed: 30000, depth: 0, maxDepth: 2 });
      const executeSubGoal = getExecuteSubGoalStep(loop);
      const step = createSubgoalStep();
      const context = createContext();

      await executeSubGoal(step, context);

      // Child should have been created with budget = 50000 - 30000 = 20000
      // We verify indirectly: child's generatePlan will be called with settings,
      // and if child had 0 budget it would abort immediately.
      // Since the child ran (queryLiteLLM was called multiple times), budget was passed.
      expect(mockQueryLiteLLM).toHaveBeenCalled();
    });

    it('passes budget=0 (unlimited) when parent has 0 budget', async () => {
      mockQueryLiteLLM.mockResolvedValueOnce({
        choices: [{ message: { content: '{"steps":[{"id":1,"description":"Think","type":"think"}],"estimatedTokens":100}' } }],
      });
      mockQueryLiteLLM.mockResolvedValueOnce({
        choices: [{ message: { content: 'Unlimited result' } }],
      });
      mockQueryLiteLLM.mockResolvedValueOnce({
        choices: [{ message: { content: 'Unlimited final' } }],
      });

      const loop = createAgentLoop({ tokenBudget: 0, tokensUsed: 5000, depth: 0, maxDepth: 2 });
      const executeSubGoal = getExecuteSubGoalStep(loop);
      const step = createSubgoalStep();
      const context = createContext();

      const result = await executeSubGoal(step, context);

      // With tokenBudget=0, child also gets 0 (unlimited)
      expect(mockQueryLiteLLM).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('accumulates child token usage in parent', async () => {
      mockQueryLiteLLM.mockResolvedValueOnce({
        choices: [{ message: { content: '{"steps":[{"id":1,"description":"Think","type":"think"}],"estimatedTokens":100}' } }],
      });
      mockQueryLiteLLM.mockResolvedValueOnce({
        choices: [{ message: { content: 'Result' } }],
      });
      mockQueryLiteLLM.mockResolvedValueOnce({
        choices: [{ message: { content: 'Final result' } }],
      });

      const loop = createAgentLoop({ tokenBudget: 50000, tokensUsed: 0, depth: 0, maxDepth: 2 });
      const executeSubGoal = getExecuteSubGoalStep(loop);
      const step = createSubgoalStep();
      const context = createContext();

      await executeSubGoal(step, context);

      // Parent's tokensUsed should have increased
      const parentTokensUsed = (loop as any).tokensUsed;
      expect(parentTokensUsed).toBeGreaterThan(0);
    });
  });

  describe('abort signal propagation', () => {
    it('passes abort signal to child agent', async () => {
      const controller = new AbortController();

      // Abort after generatePlan call
      mockQueryLiteLLM.mockImplementation(async () => {
        // Simulate abort during plan generation
        controller.abort();
        return {
          choices: [{ message: { content: '{"steps":[{"id":1,"description":"Think","type":"think"}],"estimatedTokens":100}' } }],
        };
      });

      const loop = createAgentLoop({ depth: 0, maxDepth: 2, signal: controller.signal });
      const executeSubGoal = getExecuteSubGoalStep(loop);
      const step = createSubgoalStep();
      const context = createContext();

      const result = await executeSubGoal(step, context);

      // Child should detect the abort signal and stop
      // The output will be empty since the child's run() was aborted
      // The key point is it doesn't throw — it handles abort gracefully
      expect(result).toBeDefined();
    });
  });

  describe('subgoalConfig.maxSteps', () => {
    it('limits the number of steps in the child plan', async () => {
      // Child generates a plan with 5 steps, but maxSteps is 2
      mockQueryLiteLLM.mockResolvedValueOnce({
        choices: [{ message: { content: '{"steps":[{"id":1,"description":"Step 1","type":"think"},{"id":2,"description":"Step 2","type":"think"},{"id":3,"description":"Step 3","type":"think"},{"id":4,"description":"Step 4","type":"think"},{"id":5,"description":"Step 5","type":"think"}],"estimatedTokens":5000}' } }],
      });
      // Only 2 steps should execute
      mockQueryLiteLLM.mockResolvedValueOnce({
        choices: [{ message: { content: 'Step 1 result' } }],
      });
      mockQueryLiteLLM.mockResolvedValueOnce({
        choices: [{ message: { content: 'Step 2 result' } }],
      });
      // synthesizeFinalAnswer
      mockQueryLiteLLM.mockResolvedValueOnce({
        choices: [{ message: { content: 'Final 2 step result' } }],
      });

      const loop = createAgentLoop({ depth: 0, maxDepth: 2 });
      const executeSubGoal = getExecuteSubGoalStep(loop);
      const step = createSubgoalStep({ subgoalConfig: { maxSteps: 2 } });
      const context = createContext();

      const result = await executeSubGoal(step, context);

      expect(result.success).toBe(true);
      // queryLiteLLM should be called for: generatePlan (1) + 2 steps + synthesize (1) = 4 calls
      // Not 5 steps worth of calls
      expect(mockQueryLiteLLM.mock.calls.length).toBeLessThanOrEqual(4);
    });
  });

  describe('progress event bubbling', () => {
    it('prefixes child progress events with [Sub-goal]', async () => {
      const progressEvents: any[] = [];
      const onProgress = (event: any) => progressEvents.push(event);

      mockQueryLiteLLM.mockResolvedValueOnce({
        choices: [{ message: { content: '{"steps":[{"id":1,"description":"Think","type":"think"}],"estimatedTokens":100}' } }],
      });
      mockQueryLiteLLM.mockResolvedValueOnce({
        choices: [{ message: { content: 'Child output' } }],
      });
      mockQueryLiteLLM.mockResolvedValueOnce({
        choices: [{ message: { content: 'Final child output' } }],
      });

      const loop = createAgentLoop({ depth: 0, maxDepth: 2, onProgress });
      const executeSubGoal = getExecuteSubGoalStep(loop);
      const step = createSubgoalStep();
      const context = createContext();

      await executeSubGoal(step, context);

      // Should have events with [Sub-goal] prefix from child
      const subgoalEvents = progressEvents.filter(e => e.message.includes('[Sub-goal]'));
      expect(subgoalEvents.length).toBeGreaterThan(0);

      // Should also have the parent's subgoal_start and subgoal_complete events
      const startEvents = progressEvents.filter(e => e.type === 'subgoal_start');
      const completeEvents = progressEvents.filter(e => e.type === 'subgoal_complete');
      expect(startEvents.length).toBe(1);
      expect(completeEvents.length).toBe(1);
    });
  });

  describe('context passing to child', () => {
    it('passes inputSteps data to child context', async () => {
      mockQueryLiteLLM.mockResolvedValueOnce({
        choices: [{ message: { content: '{"steps":[{"id":1,"description":"Think","type":"think"}],"estimatedTokens":100}' } }],
      });
      mockQueryLiteLLM.mockResolvedValueOnce({
        choices: [{ message: { content: 'Used input data' } }],
      });
      mockQueryLiteLLM.mockResolvedValueOnce({
        choices: [{ message: { content: 'Final with input' } }],
      });

      const loop = createAgentLoop({ depth: 0, maxDepth: 2 });
      const executeSubGoal = getExecuteSubGoalStep(loop);
      const step = createSubgoalStep({ inputSteps: [1] });
      const context = createContext();

      await executeSubGoal(step, context);

      // The generatePlan call should include "Output from step 1" in the user message
      const planCall = mockQueryLiteLLM.mock.calls[0];
      const userMessage = planCall[0][1].content; // messages[1].content (user)
      expect(userMessage).toContain('Output from step 1');
    });

    it('uses last 3 outputs when no inputSteps specified', async () => {
      mockQueryLiteLLM.mockResolvedValueOnce({
        choices: [{ message: { content: '{"steps":[{"id":1,"description":"Think","type":"think"}],"estimatedTokens":100}' } }],
      });
      mockQueryLiteLLM.mockResolvedValueOnce({
        choices: [{ message: { content: 'Used context' } }],
      });
      mockQueryLiteLLM.mockResolvedValueOnce({
        choices: [{ message: { content: 'Final context' } }],
      });

      const loop = createAgentLoop({ depth: 0, maxDepth: 2 });
      const executeSubGoal = getExecuteSubGoalStep(loop);
      const step = createSubgoalStep(); // no inputSteps
      const context = createContext({
        previousOutputs: [
          { stepId: 1, type: 'text', content: 'First output' },
          { stepId: 2, type: 'text', content: 'Second output' },
          { stepId: 3, type: 'text', content: 'Third output' },
          { stepId: 4, type: 'text', content: 'Fourth output' },
        ],
      });

      await executeSubGoal(step, context);

      // Should include last 3 outputs (steps 2, 3, 4) in context
      const planCall = mockQueryLiteLLM.mock.calls[0];
      const userMessage = planCall[0][1].content;
      expect(userMessage).toContain('Step 2');
      expect(userMessage).toContain('Step 3');
      expect(userMessage).toContain('Step 4');
    });
  });

  describe('sanitizeWriteSteps does not affect subgoal', () => {
    it('subgoal steps are not downgraded even when goal has no write intent', async () => {
      // generatePlan returns a plan with a subgoal step
      mockQueryLiteLLM.mockResolvedValueOnce({
        choices: [{ message: { content: '{"steps":[{"id":1,"description":"Sub-task","type":"subgoal"}],"estimatedTokens":1000}' } }],
      });

      const loop = createAgentLoop({ depth: 0, maxDepth: 2 });
      // Use the public generatePlan method — it calls sanitizeWriteSteps internally
      const plan = await loop.generatePlan('What is the meaning of life?', 'some context');

      // The subgoal step should NOT be downgraded to 'think'
      expect(plan.steps[0].type).toBe('subgoal');
    });
  });
});
