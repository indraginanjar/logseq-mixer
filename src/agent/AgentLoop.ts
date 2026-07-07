import { queryLiteLLM, getContextLimitForModel, type ChatMessage } from 'LLMManager';
import { countTokens, encode, decode } from 'tokenizer';
import { MCPManager } from 'mcp/MCPManager';
import { executeOne } from 'blockExecutor';
import { runReActLoop } from './ReActLoop';
import type { AgentPlan, AgentStep, AgentProgressEvent, StepResult, StepContext } from './types';

const PLAN_SYSTEM_PROMPT = `You are a planning agent for a Logseq knowledge management system. Break down the user's goal into atomic steps.

Available capabilities:
- read: Read a single Logseq page or get block trees
- write: Insert, update, or delete blocks in Logseq pages; create new pages
- search: Search the knowledge base using hybrid vector+keyword search
- tool: Use external MCP tools (if available)
- think: Analyze information and reason about next steps
- gather: Read MULTIPLE pages in batches, extracting and summarizing key information from each. Use this when the goal requires processing more than 3 pages or collecting data across many sources. The gather step handles batching, per-page summarization, and accumulation automatically.

Respond with ONLY valid JSON in this format:
{"steps":[{"id":1,"description":"...","type":"read|write|search|tool|think|gather"}],"estimatedTokens":NUMBER}

PLANNING RULES:
- Use "gather" when the goal involves reading/processing multiple pages (e.g., "find all pages about X and extract Y", "summarize my notes on Z", "create an overview from multiple sources").
- A gather step description should specify WHAT to look for and WHAT to extract. Example: "Gather all machine learning pages and extract key concepts, definitions, and relationships from each."
- Use "search" first to find relevant pages, then "gather" to process them in bulk.
- Use "read" only for reading a single specific page.
- Keep steps atomic and sequential. Estimate total tokens needed for all LLM calls.`;

const STEP_SYSTEM_PROMPT = `You are an execution agent for Logseq. Execute the given step and return the ACTUAL result — not a plan or description of what to do.
Available Logseq APIs: getPage(name), getPageBlocksTree(nameOrUuid), getAllPages(), insertBlock(parentUUID, content, {sibling:false}), updateBlock(uuid, content), removeBlock(uuid), createPage(name, {}, {journal:false, redirect:false}).

CRITICAL RULES:
- For "think" steps: produce the ACTUAL output described (e.g., if the step says "construct a table", write the complete table with real data from previous context — do NOT write a plan for how to construct it).
- For action steps: respond with a JSON action to execute.
- NEVER respond with plans, outlines, or "next steps" — always produce the final deliverable directly.
- Use the data from "Previous context" AND "Gathered Data (Working Memory)" as your source material. The Gathered Data section contains comprehensive extractions from multiple pages — this is your PRIMARY data source when available. Use it to produce the output.`;

const EVAL_SYSTEM_PROMPT = `Evaluate whether the step output achieved the intended goal. Respond with ONLY valid JSON:
{"adequate":true,"reason":"...","suggestion":"alternative approach if inadequate"}
Set adequate to false only if the output clearly failed to achieve the intent.`;

const REPLAN_SYSTEM_PROMPT = `You are reviewing an in-progress execution plan. Given the goal, progress so far, and remaining steps, decide if the plan needs adjustment.
Respond with ONLY valid JSON:
{"replan":true/false,"reason":"...","newSteps":[{"id":1,"description":"...","type":"read|write|search|tool|think"}]}
If replan is false, newSteps can be empty. Only include the REMAINING steps (not already completed ones).`;

const GATHER_SUMMARIZE_PROMPT = `You are a data extraction agent. Given the content of a Logseq page, extract and summarize the key information relevant to the user's goal. Be thorough — include all facts, concepts, relationships, dates, and details that could be useful. Respond with a structured summary, not the raw block content.`;

export class AgentLoop {
  private settings: any;
  private signal?: AbortSignal;
  private tokensUsed = 0;
  private tokenBudget: number;
  private maxRetries: number;
  private canWrite: boolean;
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
    onProgress: (event: AgentProgressEvent) => void;
    onEscalate: (question: string) => Promise<string>;
    onReplanProposed: (reason: string, newSteps: AgentStep[]) => Promise<boolean>;
  }) {
    this.settings = opts.settings;
    this.signal = opts.signal;
    this.tokenBudget = opts.tokenBudget;
    this.maxRetries = opts.maxRetries;
    this.canWrite = opts.canWrite;
    this.onProgress = opts.onProgress;
    this.onEscalate = opts.onEscalate;
    this.onReplanProposed = opts.onReplanProposed;
  }

  async generatePlan(goal: string, context: string): Promise<AgentPlan> {
    const tools = MCPManager.getInstance().getEnabledTools();
    const toolList = tools.length > 0
      ? `\nAvailable MCP tools: ${tools.map((t: any) => t.function.name).join(', ')}`
      : '';
    const writeConstraint = !this.canWrite
      ? '\n\nIMPORTANT: Direct Page Edit mode is OFF. Do NOT create pages or write/insert/update blocks in Logseq. Only gather information and present the results as text output. All output should be delivered in the chat response, not written to the graph.'
      : '';

    const messages: ChatMessage[] = [
      { role: 'system', content: PLAN_SYSTEM_PROMPT + toolList + writeConstraint },
      { role: 'user', content: `Goal: ${goal}\n\nCurrent context:\n${context}` },
    ];

    const result = await queryLiteLLM(messages, this.settings.selectedModel, this.settings.apiKey, this.settings.chatEndpoint || this.settings.LiteLLMLink, this.signal, undefined, this.settings.chatProvider);
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
    const context: StepContext = { previousOutputs: [], createdBlockUUIDs: [], createdPages: [], goal: plan.goal, scratchPad: new Map() };
    this.currentContext = context;
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
            const diagnostic = await this.diagnoseFailure(step, result.error || 'Unknown error', context);
            step.error = diagnostic;
            this.emit('step_failed', step, diagnostic, completedSteps, plan.steps.length);
            const answer = await this.onEscalate(`Step "${step.description}" failed.\n\n${diagnostic}\n\nHow should I proceed?`);
            context.previousOutputs.push({ stepId: step.id, output: `User guidance: ${answer}` });
            break;
          }
        } catch (err: any) {
          result = { success: false, output: '', tokensUsed: 0, error: err.message || String(err) };
          if (attempt >= this.maxRetries) {
            step.status = 'failed';
            const diagnostic = await this.diagnoseFailure(step, result.error || 'Unknown error', context);
            step.error = diagnostic;
            this.emit('step_failed', step, diagnostic, completedSteps, plan.steps.length);
            const answer = await this.onEscalate(`Step "${step.description}" failed after ${this.maxRetries} retries.\n\n${diagnostic}\n\nHow should I proceed?`);
            context.previousOutputs.push({ stepId: step.id, output: `User guidance: ${answer}` });
          }
        }
      }

      if (result?.success) {
        // Self-correction: only evaluate write and tool steps (read/think don't need quality checks)
        if (step.type === 'write' || step.type === 'tool') {
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
        }

        if (result?.success) {
          step.status = 'done';
          step.output = result.output;
          step.tokensUsed = result.tokensUsed;
          this.tokensUsed += result.tokensUsed;
          context.previousOutputs.push({ stepId: step.id, output: result.output });
          completedSteps++;
          this.emit('step_complete', step, result.output, completedSteps, plan.steps.length);

          // Replan only when something unexpected happened
          const lastOutput = context.previousOutputs[context.previousOutputs.length - 1]?.output || '';
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

    // Final synthesis: compose the complete answer using all step outputs
    if (completedSteps > 0 && !this.signal?.aborted) {
      const synthesisResult = await this.synthesizeFinalAnswer(plan, context);
      if (synthesisResult) {
        // Update the last completed step's output with the full synthesis
        const lastDone = plan.steps.filter(s => s.status === 'done').pop();
        if (lastDone) {
          lastDone.output = synthesisResult;
        }
      }
    }

    this.emit('complete', undefined, `Completed ${completedSteps}/${plan.steps.length} steps`, completedSteps, plan.steps.length);
  }

  private async synthesizeFinalAnswer(plan: AgentPlan, context: StepContext): Promise<string | null> {
    const contextLimit = getContextLimitForModel(this.settings.selectedModel);
    const maxStepOutputLen = Math.min(Math.floor(contextLimit * 0.1), 6000);

    // Build a comprehensive context from ALL step outputs
    const allOutputs = context.previousOutputs
      .map(o => `--- Step ${o.stepId} ---\n${o.output.slice(0, maxStepOutputLen)}`)
      .join('\n\n');

    // Include scratchPad gathered data (this is the key Map-Reduce integration)
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

    // Check if we have enough content worth synthesizing
    const totalContent = context.previousOutputs.reduce((sum, o) => sum + o.output.length, 0) +
      Array.from(context.scratchPad.values()).reduce((sum, v) => sum + v.length, 0);
    if (totalContent < 100) return null; // Nothing substantial to synthesize

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
      const result = await queryLiteLLM(messages, this.settings.selectedModel, this.settings.apiKey, this.settings.chatEndpoint || this.settings.LiteLLMLink, this.signal, undefined, this.settings.chatProvider);
      const raw = result.choices?.[0]?.message?.content?.trim() ?? '';
      this.tokensUsed += countTokens(JSON.stringify(messages)) + countTokens(raw);
      return raw || null;
    } catch {
      // If synthesis fails, fall back to the original last step output
      return null;
    }
  }

  private async executeStep(step: AgentStep, context: StepContext): Promise<StepResult> {
    // For the last step (synthesis/presentation), provide much more context from prior steps
    const contextLimit = getContextLimitForModel(this.settings.selectedModel);
    const isLastStep = context.previousOutputs.length >= 1 && step.type === 'think';
    const maxOutputLen = isLastStep ? Math.min(Math.floor(contextLimit * 0.3), 30000) : Math.min(Math.floor(contextLimit * 0.1), 8000);
    const maxPriorSteps = isLastStep ? context.previousOutputs.length : Math.min(context.previousOutputs.length, Math.max(5, Math.floor(contextLimit / 10000)));
    const contextSummary = context.previousOutputs.slice(-maxPriorSteps).map(o => `Step ${o.stepId}: ${o.output.slice(0, maxOutputLen)}`).join('\n\n');

    // Append scratchPad data if available (from gather steps)
    let scratchPadContext = '';
    if (context.scratchPad.size > 0) {
      const scratchBudget = Math.floor(contextLimit * 0.3);
      const entries = Array.from(context.scratchPad.entries())
        .map(([key, value]) => `[${key}]:\n${value}`)
        .join('\n\n');
      if (countTokens(entries) > scratchBudget) {
        const tokens = encode(entries);
        scratchPadContext = '\n\n--- Gathered Data (Working Memory) ---\n' + decode(tokens.slice(0, scratchBudget));
      } else {
        scratchPadContext = '\n\n--- Gathered Data (Working Memory) ---\n' + entries;
      }
    }

    // Map-Reduce gather: batch-read pages and summarize each into scratchPad
    if (step.type === 'gather') {
      return await this.executeGatherStep(step, context);
    }

    // For tool and search steps, use the full ReAct loop for iterative chaining
    if (step.type === 'tool' || step.type === 'search') {
      const messages: ChatMessage[] = [
        { role: 'system', content: STEP_SYSTEM_PROMPT },
        { role: 'user', content: `Goal: ${context.goal}\nPrevious context:\n${contextSummary}${scratchPadContext}\n\nCurrent step: ${step.description}\n\nUse the available tools to accomplish this step. Call as many tools as needed.` },
      ];
      const reactResult = await runReActLoop(messages, {
        settings: this.settings,
        signal: this.signal,
        maxIterations: 10,
        tokenBudget: this.tokenBudget > 0 ? Math.max(0, this.tokenBudget - this.tokensUsed) : 0,
        includeLogseqTools: true,
      });
      // Include key tool results in the output so subsequent steps can use the data
      const toolResultsSummary = reactResult.toolCalls
        .map(tc => `[${tc.tool}] ${tc.result.slice(0, 800)}`)
        .join('\n');
      const fullOutput = toolResultsSummary
        ? `${reactResult.answer}\n\n--- Tool Results ---\n${toolResultsSummary}`
        : reactResult.answer;
      return { success: true, output: fullOutput, tokensUsed: reactResult.tokensUsed };
    }

    // For read, write, think steps: single LLM call + action
    const messages: ChatMessage[] = [
      { role: 'system', content: STEP_SYSTEM_PROMPT },
      { role: 'user', content: `Goal: ${context.goal}\nPrevious context:\n${contextSummary}${scratchPadContext}\n\nCurrent step (type=${step.type}): ${step.description}\n\n${step.type === 'think' ? 'Using ALL the data above — especially the "Gathered Data (Working Memory)" section if present — produce the COMPLETE output described in this step. Write the actual content (table, analysis, summary, etc.) — not a plan or outline for how to produce it.' : 'Provide the JSON action to execute.'}` },
    ];

    const result = await queryLiteLLM(messages, this.settings.selectedModel, this.settings.apiKey, this.settings.chatEndpoint || this.settings.LiteLLMLink, this.signal, undefined, this.settings.chatProvider);
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
        if (!blocks || blocks.length === 0) return '(empty page)';
        const formatBlock = (b: any, depth = 0): string => {
          const indent = '  '.repeat(depth);
          let text = `${indent}- [${b.uuid}] ${b.content}\n`;
          if (b.children) {
            for (const child of b.children) text += formatBlock(child, depth + 1);
          }
          return text;
        };
        return blocks.map((b: any) => formatBlock(b)).join('');
      }
      case 'write': {
        if (!this.canWrite) {
          return `[Direct Page Edit OFF] Would ${action.action}: ${action.content || action.pageName || 'block operation'}`;
        }
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

  private async executeGatherStep(step: AgentStep, context: StepContext): Promise<StepResult> {
    let totalTokens = 0;

    // Determine which pages to gather from prior step outputs
    const priorOutputs = context.previousOutputs.map(o => o.output).join('\n');

    // Ask LLM to extract page names from prior context
    const extractMessages: ChatMessage[] = [
      { role: 'system', content: 'Extract a JSON array of Logseq page names from the given context. Return ONLY a JSON array of strings, e.g. ["page1", "page2"]. If the context mentions page names, include them all. If no pages are mentioned, return an empty array [].' },
      { role: 'user', content: `Goal: ${context.goal}\nStep description: ${step.description}\n\nPrior context:\n${priorOutputs.slice(0, 4000)}` },
    ];

    const extractResult = await queryLiteLLM(extractMessages, this.settings.selectedModel, this.settings.apiKey, this.settings.chatEndpoint || this.settings.LiteLLMLink, this.signal, undefined, this.settings.chatProvider);
    const extractRaw = extractResult.choices?.[0]?.message?.content?.trim() ?? '[]';
    totalTokens += countTokens(JSON.stringify(extractMessages)) + countTokens(extractRaw);

    let pageNames: string[] = [];
    try {
      const jsonMatch = extractRaw.match(/\[[\s\S]*\]/);
      pageNames = JSON.parse(jsonMatch ? jsonMatch[0] : extractRaw);
    } catch {
      // Fallback: split by newlines/commas
      pageNames = priorOutputs.split(/[\n,]/).map(s => s.trim()).filter(s => s.length > 0 && s.length < 100).slice(0, 30);
    }

    if (pageNames.length === 0) {
      return { success: true, output: 'No pages found to gather from.', tokensUsed: totalTokens };
    }

    // Process pages in batches
    const BATCH_SIZE = 3;
    const contextLimit = getContextLimitForModel(this.settings.selectedModel);
    const maxPageTokens = Math.floor(contextLimit * 0.5);
    const summaries: string[] = [];

    for (let i = 0; i < pageNames.length; i += BATCH_SIZE) {
      if (this.signal?.aborted) break;
      if (this.tokenBudget > 0 && this.tokensUsed + totalTokens >= this.tokenBudget) break;

      const batch = pageNames.slice(i, i + BATCH_SIZE);

      // Read all pages in this batch
      let batchContent = '';
      for (const pageName of batch) {
        try {
          const blocks = await logseq.Editor.getPageBlocksTree(pageName);
          if (blocks && blocks.length > 0) {
            const formatBlock = (b: any, depth = 0): string => {
              const indent = '  '.repeat(depth);
              let text = `${indent}- ${b.content}\n`;
              if (b.children) {
                for (const child of b.children) text += formatBlock(child, depth + 1);
              }
              return text;
            };
            const pageContent = blocks.map((b: any) => formatBlock(b)).join('');
            batchContent += `\n--- Page: ${pageName} ---\n${pageContent}\n`;
          }
        } catch {
          batchContent += `\n--- Page: ${pageName} ---\n(failed to read)\n`;
        }
      }

      // Truncate batch content to fit context
      if (countTokens(batchContent) > maxPageTokens) {
        const tokens = encode(batchContent);
        batchContent = decode(tokens.slice(0, maxPageTokens)) + '\n... (truncated)';
      }

      // Summarize this batch (Map phase)
      const summarizeMessages: ChatMessage[] = [
        { role: 'system', content: GATHER_SUMMARIZE_PROMPT },
        { role: 'user', content: `Goal: ${context.goal}\nExtraction task: ${step.description}\n\nPages content (batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(pageNames.length / BATCH_SIZE)}):\n${batchContent}\n\nExtract ALL relevant information from these pages. Be comprehensive.` },
      ];

      const batchResult = await queryLiteLLM(summarizeMessages, this.settings.selectedModel, this.settings.apiKey, this.settings.chatEndpoint || this.settings.LiteLLMLink, this.signal, undefined, this.settings.chatProvider);
      const batchSummary = batchResult.choices?.[0]?.message?.content?.trim() ?? '';
      totalTokens += countTokens(JSON.stringify(summarizeMessages)) + countTokens(batchSummary);

      if (batchSummary) {
        summaries.push(`[Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.join(', ')}]\n${batchSummary}`);
      }
    }

    // Store accumulated summaries in scratchPad (Reduce input)
    const gatherKey = `gather_step_${step.id}`;
    const fullGatheredData = summaries.join('\n\n---\n\n');
    context.scratchPad.set(gatherKey, fullGatheredData);

    // Return gathered data as step output so it flows through previousOutputs too
    // (scratchPad is primary, but this ensures data is available even if scratchPad access fails)
    const outputSummary = fullGatheredData
      ? `Gathered and summarized ${pageNames.length} pages in ${Math.ceil(pageNames.length / BATCH_SIZE)} batches. Pages: ${pageNames.join(', ')}\n\n${fullGatheredData}`
      : `Gathered 0 results from ${pageNames.length} pages. Pages may not exist or may be empty.`;
    return { success: true, output: outputSummary, tokensUsed: totalTokens };
  }

  private async handleFailure(step: AgentStep, error: string, attempt: number): Promise<'retry' | 'escalate' | 'skip'> {
    if ((step.type === 'read' || step.type === 'search') && /not found|empty|null/i.test(error)) return 'skip';
    if (attempt < this.maxRetries) return 'retry';
    return 'escalate';
  }

  private async diagnoseFailure(step: AgentStep, error: string, context: StepContext): Promise<string> {
    try {
      const recentContext = context.previousOutputs.slice(-3).map(o => `Step ${o.stepId}: ${o.output.slice(0, 200)}`).join('\n');
      const messages: ChatMessage[] = [
        {
          role: 'system',
          content: `You are a diagnostic agent. Given a failed step, its error, and execution context, provide a brief, clear explanation of:
1. WHAT failed (one sentence)
2. WHY it likely failed (one sentence identifying the root cause)
3. SUGGESTION (one actionable sentence on how to fix or work around it)

Be concise and specific. Do not repeat the raw error verbatim — translate it into plain language the user can act on.`,
        },
        {
          role: 'user',
          content: `Step: "${step.description}" (type: ${step.type})\nError: ${error}\nGoal: ${context.goal}\nRecent context:\n${recentContext}`,
        },
      ];
      const result = await queryLiteLLM(messages, this.settings.selectedModel, this.settings.apiKey, this.settings.chatEndpoint || this.settings.LiteLLMLink, this.signal, undefined, this.settings.chatProvider);
      const diagnostic = result.choices?.[0]?.message?.content?.trim() ?? '';
      this.tokensUsed += countTokens(JSON.stringify(messages)) + countTokens(diagnostic);
      if (diagnostic) return diagnostic;
    } catch {
      // If diagnostic LLM call fails, fall back to raw error
    }
    return `Error: ${error}`;
  }

  private async rollback(context: StepContext): Promise<void> {
    for (const pageName of context.createdPages) {
      try {
        await logseq.Editor.deletePage(pageName);
      } catch { /* ignore */ }
    }
    for (const uuid of context.createdBlockUUIDs) {
      try {
        await logseq.Editor.removeBlock(uuid);
      } catch { /* ignore */ }
    }
  }

  async rollbackLastRun(): Promise<string> {
    if (!this.currentContext) return 'Nothing to rollback';
    const pages = this.currentContext.createdPages.length;
    const blocks = this.currentContext.createdBlockUUIDs.length;
    if (pages === 0 && blocks === 0) return 'Nothing to rollback';
    await this.rollback(this.currentContext);
    const msg = `Rolled back: ${pages} page(s) and ${blocks} block(s) removed`;
    this.currentContext = null;
    return msg;
  }

  resolveEscalation(answer: string): void {
    if (this.escalationResolver) this.escalationResolver(answer);
  }

  private async evaluateStep(step: AgentStep, result: StepResult, _context: StepContext): Promise<{ adequate: boolean; reason: string; suggestion: string }> {
    const messages: ChatMessage[] = [
      { role: 'system', content: EVAL_SYSTEM_PROMPT },
      { role: 'user', content: `Step intent: ${step.description}\nStep type: ${step.type}\nOutput received:\n${result.output.slice(0, 500)}\n\nWas the intent achieved?` },
    ];
    const llmResult = await queryLiteLLM(messages, this.settings.selectedModel, this.settings.apiKey, this.settings.chatEndpoint || this.settings.LiteLLMLink, this.signal, undefined, this.settings.chatProvider);
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

    const result = await queryLiteLLM(messages, this.settings.selectedModel, this.settings.apiKey, this.settings.chatEndpoint || this.settings.LiteLLMLink, this.signal, undefined, this.settings.chatProvider);
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
