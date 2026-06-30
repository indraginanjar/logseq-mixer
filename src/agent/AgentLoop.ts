import { queryLiteLLM, type ChatMessage } from 'LLMManager';
import { countTokens } from 'tokenizer';
import { MCPManager } from 'mcp/MCPManager';
import { executeOne } from 'blockExecutor';
import { runReActLoop } from './ReActLoop';
import type { AgentPlan, AgentStep, AgentProgressEvent, StepResult, StepContext } from './types';

const PLAN_SYSTEM_PROMPT = `You are a planning agent for a Logseq knowledge management system. Break down the user's goal into atomic steps.

Available capabilities:
- read: Read Logseq pages, get block trees, get current page
- write: Insert, update, or delete blocks in Logseq pages; create new pages
- search: Search the knowledge base using hybrid vector+keyword search
- tool: Use external MCP tools (if available)
- think: Analyze information and reason about next steps

Respond with ONLY valid JSON in this format:
{"steps":[{"id":1,"description":"...","type":"read|write|search|tool|think"}],"estimatedTokens":NUMBER}

Keep steps atomic and sequential. Estimate total tokens needed for all LLM calls.`;

const STEP_SYSTEM_PROMPT = `You are an execution agent for Logseq. Execute the given step and return the result.
Available Logseq APIs: getPage(name), getPageBlocksTree(nameOrUuid), getAllPages(), insertBlock(parentUUID, content, {sibling:false}), updateBlock(uuid, content), removeBlock(uuid), createPage(name, {}, {journal:false, redirect:false}).
Respond with a JSON action to take, or plain text analysis for "think" steps.`;

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
  private onProgress: (event: AgentProgressEvent) => void;
  private onEscalate: (question: string) => Promise<string>;
  private onReplanProposed: (reason: string, newSteps: AgentStep[]) => Promise<boolean>;
  private escalationResolver: ((answer: string) => void) | null = null;

  constructor(opts: {
    settings: any;
    signal?: AbortSignal;
    tokenBudget: number;
    maxRetries: number;
    onProgress: (event: AgentProgressEvent) => void;
    onEscalate: (question: string) => Promise<string>;
    onReplanProposed: (reason: string, newSteps: AgentStep[]) => Promise<boolean>;
  }) {
    this.settings = opts.settings;
    this.signal = opts.signal;
    this.tokenBudget = opts.tokenBudget;
    this.maxRetries = opts.maxRetries;
    this.onProgress = opts.onProgress;
    this.onEscalate = opts.onEscalate;
    this.onReplanProposed = opts.onReplanProposed;
  }

  async generatePlan(goal: string, context: string): Promise<AgentPlan> {
    const tools = MCPManager.getInstance().getEnabledTools();
    const toolList = tools.length > 0
      ? `\nAvailable MCP tools: ${tools.map((t: any) => t.function.name).join(', ')}`
      : '';

    const messages: ChatMessage[] = [
      { role: 'system', content: PLAN_SYSTEM_PROMPT + toolList },
      { role: 'user', content: `Goal: ${goal}\n\nCurrent context:\n${context}` },
    ];

    const result = await queryLiteLLM(messages, this.settings.selectedModel, this.settings.apiKey, this.settings.LiteLLMLink, this.signal);
    const raw = result.choices?.[0]?.message?.content?.trim() ?? '';
    this.tokensUsed += countTokens(JSON.stringify(messages)) + countTokens(raw);

    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
      const steps: AgentStep[] = (parsed.steps || []).map((s: any, i: number) => ({
        id: s.id ?? i + 1,
        description: s.description,
        type: s.type || 'think',
        tool: s.tool,
        status: 'pending' as const,
      }));
      return { goal, steps, estimatedTokens: parsed.estimatedTokens || 50000 };
    } catch {
      return { goal, steps: [{ id: 1, description: goal, type: 'think', status: 'pending' }], estimatedTokens: 10000 };
    }
  }

  async run(plan: AgentPlan): Promise<void> {
    const context: StepContext = { previousOutputs: [], createdBlockUUIDs: [], createdPages: [], goal: plan.goal };
    let completedSteps = 0;

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
          const action = await this.handleFailure(step, result.error || 'Unknown error', attempt);
          if (action === 'skip') { result = { success: true, output: '(skipped)', tokensUsed: 0 }; break; }
          if (action === 'escalate') {
            const answer = await this.onEscalate(`Step "${step.description}" failed: ${result.error}\nHow should I proceed?`);
            context.previousOutputs.push({ stepId: step.id, output: `User guidance: ${answer}` });
            break;
          }
        } catch (err: any) {
          result = { success: false, output: '', tokensUsed: 0, error: err.message || String(err) };
          if (attempt >= this.maxRetries) {
            step.status = 'failed';
            step.error = result.error;
            this.emit('step_failed', step, result.error!, completedSteps, plan.steps.length);
            const answer = await this.onEscalate(`Step "${step.description}" failed after ${this.maxRetries} retries: ${result.error}\nHow should I proceed?`);
            context.previousOutputs.push({ stepId: step.id, output: `User guidance: ${answer}` });
          }
        }
      }

      if (result?.success) {
        // Self-correction: evaluate output quality
        const evaluation = await this.evaluateStep(step, result, context);
        if (!evaluation.adequate && (step.correctionAttempts || 0) < this.maxRetries) {
          step.correctionAttempts = (step.correctionAttempts || 0) + 1;
          step.correctionReason = evaluation.reason;
          this.emit('self_correcting', step, `Self-correcting: ${evaluation.reason}`, completedSteps, plan.steps.length);
          context.previousOutputs.push({ stepId: step.id, output: `Previous attempt inadequate: ${evaluation.reason}. Suggestion: ${evaluation.suggestion}` });
          step.status = 'running';
          try {
            result = await this.executeStep(step, context);
          } catch (err: any) {
            result = { success: false, output: '', tokensUsed: 0, error: err.message };
          }
        }

        if (result?.success) {
          step.status = 'done';
          step.output = result.output;
          step.tokensUsed = result.tokensUsed;
          this.tokensUsed += result.tokensUsed;
          context.previousOutputs.push({ stepId: step.id, output: result.output });
          completedSteps++;
          this.emit('step_complete', step, result.output, completedSteps, plan.steps.length);

          // Replan check every 2 completed steps
          if (completedSteps % 2 === 0 && completedSteps < plan.steps.length) {
            await this.replanIfNeeded(plan, context, completedSteps);
          }
        }
      }
    }

    this.emit('complete', undefined, `Completed ${completedSteps}/${plan.steps.length} steps`, completedSteps, plan.steps.length);
  }

  private async executeStep(step: AgentStep, context: StepContext): Promise<StepResult> {
    const contextSummary = context.previousOutputs.slice(-3).map(o => `Step ${o.stepId}: ${o.output.slice(0, 200)}`).join('\n');

    // For tool and search steps, use the full ReAct loop for iterative chaining
    if (step.type === 'tool' || step.type === 'search') {
      const messages: ChatMessage[] = [
        { role: 'system', content: STEP_SYSTEM_PROMPT },
        { role: 'user', content: `Goal: ${context.goal}\nPrevious context:\n${contextSummary}\n\nCurrent step: ${step.description}\n\nUse the available tools to accomplish this step. Call as many tools as needed.` },
      ];
      const reactResult = await runReActLoop(messages, {
        settings: this.settings,
        signal: this.signal,
        maxIterations: 10,
        tokenBudget: this.tokenBudget > 0 ? Math.max(0, this.tokenBudget - this.tokensUsed) : 0,
        includeLogseqTools: true,
      });
      return { success: true, output: reactResult.answer, tokensUsed: reactResult.tokensUsed };
    }

    // For read, write, think steps: single LLM call + action
    const messages: ChatMessage[] = [
      { role: 'system', content: STEP_SYSTEM_PROMPT },
      { role: 'user', content: `Goal: ${context.goal}\nPrevious context:\n${contextSummary}\n\nCurrent step (type=${step.type}): ${step.description}\n\nProvide the action or analysis.` },
    ];

    const result = await queryLiteLLM(messages, this.settings.selectedModel, this.settings.apiKey, this.settings.LiteLLMLink, this.signal);
    const raw = result.choices?.[0]?.message?.content?.trim() ?? '';
    const tokens = countTokens(JSON.stringify(messages)) + countTokens(raw);

    if (step.type === 'think') {
      return { success: true, output: raw, tokensUsed: tokens };
    }

    // Try to parse as JSON action; if LLM returned natural language instead, treat as analysis
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { success: true, output: raw, tokensUsed: tokens };
    }

    try {
      const action = JSON.parse(jsonMatch[0]);
      const output = await this.executeAction(step.type, action, context);
      return { success: true, output, tokensUsed: tokens };
    } catch (err: any) {
      // If JSON parse fails or action execution fails, return the raw text as context
      if (err instanceof SyntaxError) {
        return { success: true, output: raw, tokensUsed: tokens };
      }
      return { success: false, output: raw, tokensUsed: tokens, error: err.message || String(err) };
    }
  }

  private async executeAction(type: string, action: any, context: StepContext): Promise<string> {
    switch (type) {
      case 'read': {
        const pageName = action.page || action.pageName;
        if (!pageName) return 'No page specified';
        const blocks = await logseq.Editor.getPageBlocksTree(pageName);
        return blocks?.map((b: any) => b.content).join('\n') || '(empty page)';
      }
      case 'write': {
        const cmd = { action: action.action, blockUUID: action.blockUUID, parentBlockUUID: action.parentBlockUUID, content: action.content };
        if (action.action === 'createPage') {
          const page = await logseq.Editor.createPage(action.pageName, {}, { journal: false, redirect: false });
          if (page) context.createdPages.push(action.pageName);
          return `Created page: ${action.pageName}`;
        }
        const outcome = await executeOne(cmd);
        if (outcome.status === 'success') {
          if (outcome.insertedBlockUUID) context.createdBlockUUIDs.push(outcome.insertedBlockUUID);
          return `${action.action} succeeded`;
        }
        throw new Error(outcome.error || `${action.action} failed`);
      }
      case 'search': {
        const query = action.query || action.search;
        const pages = await logseq.Editor.getAllPages();
        const matches = (pages || []).filter((p: any) => p.name?.toLowerCase().includes(query?.toLowerCase())).slice(0, 10);
        return matches.map((p: any) => p.name).join(', ') || 'No results';
      }
      case 'tool': {
        const toolName = action.tool || action.name;
        const toolArgs = action.args || action.arguments || {};
        const toolResult = await MCPManager.getInstance().executeToolCall(toolName, toolArgs);
        return toolResult;
      }
      default:
        return 'Unknown step type';
    }
  }

  private async handleFailure(step: AgentStep, error: string, attempt: number): Promise<'retry' | 'escalate' | 'skip'> {
    if ((step.type === 'read' || step.type === 'search') && /not found|empty|null/i.test(error)) return 'skip';
    if (attempt < this.maxRetries) return 'retry';
    return 'escalate';
  }

  resolveEscalation(answer: string): void {
    if (this.escalationResolver) this.escalationResolver(answer);
  }

  private async evaluateStep(step: AgentStep, result: StepResult, _context: StepContext): Promise<{ adequate: boolean; reason: string; suggestion: string }> {
    const messages: ChatMessage[] = [
      { role: 'system', content: EVAL_SYSTEM_PROMPT },
      { role: 'user', content: `Step intent: ${step.description}\nStep type: ${step.type}\nOutput received:\n${result.output.slice(0, 500)}\n\nWas the intent achieved?` },
    ];
    const llmResult = await queryLiteLLM(messages, this.settings.selectedModel, this.settings.apiKey, this.settings.LiteLLMLink, this.signal);
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

    const progressSummary = context.previousOutputs.slice(-4).map(o => `Step ${o.stepId}: ${o.output.slice(0, 150)}`).join('\n');
    const remainingDesc = remaining.map(s => `${s.id}. [${s.type}] ${s.description}`).join('\n');

    const messages: ChatMessage[] = [
      { role: 'system', content: REPLAN_SYSTEM_PROMPT },
      { role: 'user', content: `Goal: ${context.goal}\n\nProgress so far:\n${progressSummary}\n\nRemaining steps:\n${remainingDesc}\n\nShould the remaining plan change?` },
    ];

    const result = await queryLiteLLM(messages, this.settings.selectedModel, this.settings.apiKey, this.settings.LiteLLMLink, this.signal);
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

  private emit(type: AgentProgressEvent['type'], step: AgentStep | undefined, message: string, completedSteps: number, totalSteps: number) {
    this.onProgress({ type, step, message, tokensUsed: this.tokensUsed, totalSteps, completedSteps });
  }
}
