import { queryLiteLLM, getContextLimitForModel, resolveChatEndpoint, resolveApiKey, type ChatMessage } from 'LLMManager';
import { countTokens, encode, decode } from 'tokenizer';
import type { AgentPlan, AgentStep, AgentProgressEvent, StepResult, StepContext } from './types';
import { generatePlan as generatePlanFn } from './planGenerator';
import { executeStep as executeStepFn, setAgentLoopFactory } from './stepExecutors';
import { handleFailure as handleFailureFn, diagnoseFailure as diagnoseFailureFn, rollbackLastRun as rollbackLastRunFn } from './failureHandler';
import { compressContext as compressContextFn } from './contextCompressor';
import { logTokenUsage } from '../storage/logTokenUsage';

const EVAL_SYSTEM_PROMPT = `Evaluate whether the step output achieved the intended goal. Respond with ONLY valid JSON:
{"adequate":true,"reason":"...","suggestion":"alternative approach if inadequate"}
Set adequate to false only if the output clearly failed to achieve the intent.`;

const REPLAN_SYSTEM_PROMPT = `You are reviewing an in-progress execution plan. Given the goal, progress so far, and remaining steps, decide if the plan needs adjustment.
Respond with ONLY valid JSON:
{"replan":true/false,"reason":"...","newSteps":[{"id":1,"description":"...","type":"read|write|search|tool|think"}]}
If replan is false, newSteps can be empty. Only include the REMAINING steps (not already completed ones).`;

export class AgentLoop {
  private settings: any;
  private signal?: AbortSignal;
  private tokensUsed = 0;
  private tokenBudget: number;
  private maxRetries: number;
  private canWrite: boolean;
  private depth: number;
  private maxDepth: number;
  private memoryStore?: any;
  private memoryReadOnly: boolean;
  private onProgress: (event: AgentProgressEvent) => void;
  private onEscalate: (question: string) => Promise<string>;
  private onReplanProposed: (reason: string, newSteps: AgentStep[]) => Promise<boolean>;
  private escalationResolver: ((answer: string) => void) | null = null;
  private currentContext: StepContext | null = null;

  constructor(opts: {
    settings: any;
    signal?: AbortSignal;
    tokenBudget: number;
    maxRetries: number;
    canWrite: boolean;
    depth?: number;
    maxDepth?: number;
    memoryStore?: any;
    memoryReadOnly?: boolean;
    onProgress: (event: AgentProgressEvent) => void;
    onEscalate: (question: string) => Promise<string>;
    onReplanProposed: (reason: string, newSteps: AgentStep[]) => Promise<boolean>;
  }) {
    this.settings = opts.settings;
    this.signal = opts.signal;
    this.tokenBudget = opts.tokenBudget;
    this.maxRetries = opts.maxRetries;
    this.canWrite = opts.canWrite;
    this.depth = opts.depth ?? 0;
    this.maxDepth = opts.maxDepth ?? 2;
    this.memoryStore = opts.memoryStore;
    this.memoryReadOnly = opts.memoryReadOnly ?? false;
    this.onProgress = opts.onProgress;
    this.onEscalate = opts.onEscalate;
    this.onReplanProposed = opts.onReplanProposed;

    // Register the factory for sub-goal spawning
    setAgentLoopFactory((childOpts) => new AgentLoop(childOpts));
  }

  async generatePlan(goal: string, context: string): Promise<AgentPlan> {
    const { plan, tokensUsed } = await generatePlanFn(goal, context, {
      settings: this.settings,
      signal: this.signal,
      canWrite: this.canWrite,
    });
    this.tokensUsed += tokensUsed;
    return plan;
  }

  async run(plan: AgentPlan): Promise<void> {
    const context: StepContext = { previousOutputs: [], createdBlockUUIDs: [], createdPages: [], goal: plan.goal, scratchPad: new Map() };
    this.currentContext = context;
    let completedSteps = 0;

    // Auto-recall relevant memories at start
    if (this.memoryStore && this.settings.agentMemoryEnabled !== false) {
      const memories = this.memoryStore.searchMemories(plan.goal.slice(0, 50));
      const relevant = memories.slice(0, 5);
      if (relevant.length > 0) {
        const memoryContext = relevant.map((m: any) => `- [${m.category}] ${m.content.slice(0, 200)}`).join('\n');
        context.previousOutputs.push({ stepId: 0, type: 'text', content: `Previous observations:\n${memoryContext}` });
        this.emit('memory_recalled', undefined, `Recalled ${relevant.length} relevant memories`, 0, plan.steps.length);
      }
    }

    for (const step of plan.steps) {
      if (this.signal?.aborted) {
        this.emit('aborted', step, 'Stopped by user', completedSteps, plan.steps.length);
        return;
      }
      if (this.tokenBudget > 0 && this.tokensUsed >= this.tokenBudget) {
        this.emit('aborted', step, `Token budget exhausted (${this.tokensUsed}/${this.tokenBudget})`, completedSteps, plan.steps.length);
        return;
      }
      if (this.tokenBudget > 0 && this.tokensUsed >= this.tokenBudget * 0.8) {
        this.emit('budget_warning', step, `80% of token budget used (${this.tokensUsed}/${this.tokenBudget})`, completedSteps, plan.steps.length);
      }

      step.status = 'running';
      this.emit('step_start', step, `Executing: ${step.description}`, completedSteps, plan.steps.length);

      let result: StepResult | null = null;
      for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
        try {
          result = await this.executeStep(step, context);
          if (result.success) break;
          const action = await handleFailureFn(step, result.error || 'Unknown error', attempt, this.getFailureCtx());
          if (action === 'skip') { result = { success: true, output: '(skipped)', tokensUsed: 0 }; break; }
          if (action === 'escalate') {
            const diagnostic = await diagnoseFailureFn(step, result.error || 'Unknown error', context, this.getFailureCtx());
            step.error = diagnostic;
            this.emit('step_failed', step, diagnostic, completedSteps, plan.steps.length);
            const answer = await this.onEscalate(`Step "${step.description}" failed.\n\n${diagnostic}\n\nHow should I proceed?`);
            context.previousOutputs.push({ stepId: step.id, type: 'text', content: `User guidance: ${answer}` });
            break;
          }
        } catch (err: any) {
          result = { success: false, output: '', tokensUsed: 0, error: err.message || String(err) };
          if (attempt >= this.maxRetries) {
            step.status = 'failed';
            const diagnostic = await diagnoseFailureFn(step, result.error || 'Unknown error', context, this.getFailureCtx());
            step.error = diagnostic;
            this.emit('step_failed', step, diagnostic, completedSteps, plan.steps.length);
            const answer = await this.onEscalate(`Step "${step.description}" failed after ${this.maxRetries} retries.\n\n${diagnostic}\n\nHow should I proceed?`);
            context.previousOutputs.push({ stepId: step.id, type: 'text', content: `User guidance: ${answer}` });
          }
        }
      }

      if (result?.success) {
        if (step.type === 'write' || step.type === 'tool') {
          const evaluation = await this.evaluateStep(step, result, context);
          if (!evaluation.adequate && (step.correctionAttempts || 0) < this.maxRetries) {
            step.correctionAttempts = (step.correctionAttempts || 0) + 1;
            step.correctionReason = evaluation.reason;
            this.emit('self_correcting', step, `Self-correcting: ${evaluation.reason}`, completedSteps, plan.steps.length);
            context.previousOutputs.push({ stepId: step.id, type: 'text', content: `Previous attempt inadequate: ${evaluation.reason}. Suggestion: ${evaluation.suggestion}` });
            step.status = 'running';
            try {
              result = await this.executeStep(step, context);
            } catch (err: any) {
              result = { success: false, output: '', tokensUsed: 0, error: err.message };
            }
          }
        }

        if (result?.success) {
          step.status = 'done';
          step.output = result.output;
          step.tokensUsed = result.tokensUsed;
          this.tokensUsed += result.tokensUsed;
          context.previousOutputs.push({ stepId: step.id, type: 'text', content: result.output });
          completedSteps++;
          this.emit('step_complete', step, result.output, completedSteps, plan.steps.length);

          if (completedSteps < plan.steps.length) {
            await compressContextFn(context, this.getCompressorCtx());
          }

          const lastOutput = context.previousOutputs[context.previousOutputs.length - 1]?.content || '';
          const wasUnexpected = (step.correctionAttempts && step.correctionAttempts > 0)
            || lastOutput.includes('Error:')
            || lastOutput.includes('not found')
            || lastOutput.includes('(skipped)');
          if (wasUnexpected && completedSteps < plan.steps.length) {
            await this.replanIfNeeded(plan, context, completedSteps);
          }
        }
      }
    }

    if (completedSteps > 0 && !this.signal?.aborted) {
      const synthesisResult = await this.synthesizeFinalAnswer(plan, context);
      if (synthesisResult) {
        const lastDone = plan.steps.filter(s => s.status === 'done').pop();
        if (lastDone) {
          lastDone.output = synthesisResult;
        }
      }
    }

    this.emit('complete', undefined, `Completed ${completedSteps}/${plan.steps.length} steps`, completedSteps, plan.steps.length);

    if (this.memoryStore && !this.memoryReadOnly && this.settings.agentMemoryEnabled !== false && completedSteps > 0) {
      const lastOutput = plan.steps.filter(s => s.status === 'done').pop()?.output || '';
      if (lastOutput.length > 20) {
        const summary = lastOutput.slice(0, 500);
        this.memoryStore.addMemoryIfUnique('agent_observation', summary, plan.goal.slice(0, 100));
        this.emit('memory_stored', undefined, 'Observation stored to memory', completedSteps, plan.steps.length);
      }
    }
  }

  private async executeStep(step: AgentStep, context: StepContext): Promise<StepResult> {
    return executeStepFn(step, context, this.getStepExecutorCtx(), this.emit.bind(this));
  }

  private getStepExecutorCtx() {
    return {
      settings: this.settings,
      signal: this.signal,
      canWrite: this.canWrite,
      tokenBudget: this.tokenBudget,
      tokensUsed: this.tokensUsed,
      depth: this.depth,
      maxDepth: this.maxDepth,
      maxRetries: this.maxRetries,
      memoryStore: this.memoryStore,
      onProgress: this.onProgress,
      onEscalate: this.onEscalate,
      onReplanProposed: this.onReplanProposed,
      addTokens: (count: number) => { this.tokensUsed += count; },
    };
  }

  private getFailureCtx() {
    return {
      settings: this.settings,
      signal: this.signal,
      maxRetries: this.maxRetries,
      addTokens: (count: number) => { this.tokensUsed += count; },
    };
  }

  private getCompressorCtx() {
    return {
      settings: this.settings,
      signal: this.signal,
      addTokens: (count: number) => { this.tokensUsed += count; },
    };
  }

  private async synthesizeFinalAnswer(plan: AgentPlan, context: StepContext): Promise<string | null> {
    const contextLimit = getContextLimitForModel(this.settings.selectedModel);
    const maxStepOutputLen = Math.min(Math.floor(contextLimit * 0.1), 6000);

    const allOutputs = context.previousOutputs
      .map(o => `--- Step ${o.stepId} ---\n${o.content.slice(0, maxStepOutputLen)}`)
      .join('\n\n');

    let gatheredData = '';
    if (context.scratchPad.size > 0) {
      const scratchBudget = Math.floor(contextLimit * 0.5);
      const entries = Array.from(context.scratchPad.entries())
        .map(([key, value]) => `[${key}]:\n${value}`)
        .join('\n\n');
      if (countTokens(entries) > scratchBudget) {
        const tokens = encode(entries);
        gatheredData = '\n\n--- Gathered Data (from page reading) ---\n' + decode(tokens.slice(0, scratchBudget));
      } else {
        gatheredData = '\n\n--- Gathered Data (from page reading) ---\n' + entries;
      }
    }

    const totalContent = context.previousOutputs.reduce((sum, o) => sum + o.content.length, 0) +
      Array.from(context.scratchPad.values()).reduce((sum, v) => sum + v.length, 0);
    if (totalContent < 100) return null;

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `You are a synthesis agent that produces FINAL DELIVERABLES — not plans, not outlines, not skeletons.

Given the user's original goal and all the data gathered by prior execution steps, compose a complete, well-formatted final answer.

RULES:
- Include ALL relevant data from the steps AND the gathered data section. The gathered data contains detailed summaries extracted from multiple pages — this is your primary source material.
- If the goal asks for a table, produce a COMPLETE markdown table filled with real data extracted from the steps. Use proper markdown syntax with leading and trailing pipes (e.g. "| Header 1 | Header 2 |").
- NEVER produce: plans, outlines, "next steps", skeletons with "..." or "TBD", or descriptions of what you WOULD do.
- If some data is missing or unclear from the steps, use what IS available and note gaps briefly in a Notes column.
- Respond with ONLY the final deliverable content, ready to present to the user.`,
      },
      {
        role: 'user',
        content: `Goal: ${plan.goal}\n\nStep summaries:\n\n${allOutputs}${gatheredData}\n\nUsing ALL the data above (especially the Gathered Data section), produce the complete final answer NOW. Extract every relevant piece of information and include it in your response.`,
      },
    ];

    try {
      const result = await queryLiteLLM(messages, this.settings.selectedModel, resolveApiKey(this.settings), resolveChatEndpoint(this.settings), this.signal, undefined, this.settings.chatProvider, this.settings.reasoningEffort);
      logTokenUsage(result, this.settings.selectedModel, this.settings.chatProvider || 'litellm');
      const raw = result.choices?.[0]?.message?.content?.trim() ?? '';
      this.tokensUsed += countTokens(JSON.stringify(messages)) + countTokens(raw);
      return raw || null;
    } catch {
      return null;
    }
  }

  private async evaluateStep(step: AgentStep, result: StepResult, _context: StepContext): Promise<{ adequate: boolean; reason: string; suggestion: string }> {
    const messages: ChatMessage[] = [
      { role: 'system', content: EVAL_SYSTEM_PROMPT },
      { role: 'user', content: `Step intent: ${step.description}\nStep type: ${step.type}\nOutput received:\n${result.output.slice(0, 500)}\n\nWas the intent achieved?` },
    ];
    const llmResult = await queryLiteLLM(messages, this.settings.selectedModel, resolveApiKey(this.settings), resolveChatEndpoint(this.settings), this.signal, undefined, this.settings.chatProvider, this.settings.reasoningEffort);
    logTokenUsage(llmResult, this.settings.selectedModel, this.settings.chatProvider || 'litellm');
    const raw = llmResult.choices?.[0]?.message?.content?.trim() ?? '';
    this.tokensUsed += countTokens(JSON.stringify(messages)) + countTokens(raw);
    try {
      const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || raw);
      return { adequate: parsed.adequate !== false, reason: parsed.reason || '', suggestion: parsed.suggestion || '' };
    } catch {
      return { adequate: true, reason: '', suggestion: '' };
    }
  }

  private async replanIfNeeded(plan: AgentPlan, context: StepContext, completedSteps: number): Promise<void> {
    const remaining = plan.steps.filter(s => s.status === 'pending');
    if (remaining.length === 0) return;

    const progressSummary = context.previousOutputs.slice(-4).map(o => `Step ${o.stepId}: ${o.content.slice(0, 150)}`).join('\n');
    const remainingDesc = remaining.map(s => `${s.id}. [${s.type}] ${s.description}`).join('\n');

    const messages: ChatMessage[] = [
      { role: 'system', content: REPLAN_SYSTEM_PROMPT },
      { role: 'user', content: `Goal: ${context.goal}\n\nProgress so far:\n${progressSummary}\n\nRemaining steps:\n${remainingDesc}\n\nShould the remaining plan change?` },
    ];

    const result = await queryLiteLLM(messages, this.settings.selectedModel, resolveApiKey(this.settings), resolveChatEndpoint(this.settings), this.signal, undefined, this.settings.chatProvider, this.settings.reasoningEffort);
    logTokenUsage(result, this.settings.selectedModel, this.settings.chatProvider || 'litellm');
    const raw = result.choices?.[0]?.message?.content?.trim() ?? '';
    this.tokensUsed += countTokens(JSON.stringify(messages)) + countTokens(raw);

    try {
      const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || raw);
      if (!parsed.replan || !parsed.newSteps?.length) return;

      const newSteps: AgentStep[] = parsed.newSteps.map((s: any, i: number) => ({
        id: completedSteps + i + 1,
        description: s.description,
        type: s.type || 'think',
        status: 'pending' as const,
      }));

      this.emit('replan_proposed', undefined, parsed.reason, completedSteps, plan.steps.length);
      const approved = await this.onReplanProposed(parsed.reason, newSteps);
      if (approved) {
        plan.steps = [...plan.steps.filter(s => s.status !== 'pending'), ...newSteps];
        this.emit('replan_approved', undefined, `Plan updated: ${parsed.reason}`, completedSteps, plan.steps.length);
      }
    } catch {
      // Parse failed, skip replanning
    }
  }

  async rollbackLastRun(): Promise<string> {
    const { message, cleared } = await rollbackLastRunFn(this.currentContext);
    if (cleared) this.currentContext = null;
    return message;
  }

  resolveEscalation(answer: string): void {
    if (this.escalationResolver) this.escalationResolver(answer);
  }

  private emit(type: AgentProgressEvent['type'], step: AgentStep | undefined, message: string, completedSteps: number, totalSteps: number) {
    this.onProgress({ type, step, message, tokensUsed: this.tokensUsed, totalSteps, completedSteps });
  }
}
