import { queryLiteLLM, getContextLimitForModel, resolveChatEndpoint, resolveApiKey, type ChatMessage } from 'LLMManager';
import { countTokens, encode, decode } from 'tokenizer';
import { MCPManager } from 'mcp/MCPManager';
import { executeOne } from 'blockExecutor';
import { runReActLoop } from './ReActLoop';
import { isDiagramIntent, DIAGRAM_RULES } from '../utils/diagramIntentDetector';
import type { AgentStep, StepResult, StepContext, ProgressEventType } from './types';

const STEP_SYSTEM_PROMPT = `You are an execution agent for Logseq. Execute the given step and return the ACTUAL result — not a plan or description of what to do.
Available Logseq APIs: getPage(name), getPageBlocksTree(nameOrUuid), getAllPages(), insertBlock(parentUUID, content, {sibling:false}), updateBlock(uuid, content), removeBlock(uuid), createPage(name, {}, {journal:false, redirect:false}).

CONTEXT UNDERSTANDING:
- The block tree below shows the current page's blocks. Indentation = sub-blocks (children) of the parent block above.
- "Current/Focused Block UUID" indicates the block the user has selected. Its sub-blocks are the blocks indented directly beneath it in the tree.
- You can reference any UUID from the block tree to update or insert under any block.

For "write" action steps, respond with a JSON object specifying the action:
- To INSERT a block: {"action":"insert","parentBlockUUID":"<uuid>","content":"<text>"}
- To UPDATE a block: {"action":"update","blockUUID":"<uuid>","content":"<text>"}
- To DELETE a block: {"action":"delete","blockUUID":"<uuid>"}
- To CREATE a new page (ONLY when explicitly asked): {"action":"createPage","pageName":"<name>"}

IMPORTANT: Default to "insert" for writing content. Use "createPage" ONLY when the user explicitly requests creating a new page. If you need to write content to the current page, use "insert" with the page UUID or an existing block UUID as parentBlockUUID.

CRITICAL RULES:
- For "think" steps: produce the ACTUAL output described (e.g., if the step says "construct a table", write the complete table with real data from previous context — do NOT write a plan for how to construct it).
- For action steps: respond with a JSON action to execute.
- NEVER respond with plans, outlines, or "next steps" — always produce the final deliverable directly.
- NEVER ask for confirmation, present options, or request clarification. You are an execution agent — just do the work.
- Use the data from "Previous context" AND "Gathered Data (Working Memory)" as your source material. The Gathered Data section contains comprehensive extractions from multiple pages — this is your PRIMARY data source when available. Use it to produce the output.
- When you need to update MULTIPLE blocks, you may output a JSON ARRAY of actions: [{"action":"update","blockUUID":"...","content":"..."},{"action":"update","blockUUID":"...","content":"..."}]`;

const GATHER_SUMMARIZE_PROMPT = `You are a data extraction agent. Given the content of a Logseq page, extract and summarize the key information relevant to the user's goal. Be thorough — include all facts, concepts, relationships, dates, and details that could be useful. Respond with a structured summary, not the raw block content.`;

export interface StepExecutorContext {
  settings: any;
  signal?: AbortSignal;
  canWrite: boolean;
  tokenBudget: number;
  tokensUsed: number;
  depth: number;
  maxDepth: number;
  maxRetries: number;
  memoryStore?: any;
  onProgress: (event: any) => void;
  onEscalate: (question: string) => Promise<string>;
  onReplanProposed: (reason: string, newSteps: AgentStep[]) => Promise<boolean>;
  addTokens: (count: number) => void;
}


export async function executeRecallStep(step: AgentStep, context: StepContext, ctx: StepExecutorContext): Promise<StepResult> {
  if (!ctx.memoryStore) {
    return { success: true, output: '(No memory store available)', tokensUsed: 0 };
  }
  const query = step.description || context.goal;
  const memories = ctx.memoryStore.searchMemories(query.slice(0, 50));
  const limited = memories.slice(0, 5);
  if (limited.length === 0) {
    return { success: true, output: '(No relevant memories found)', tokensUsed: 0 };
  }
  const formatted = limited.map((m: any) => `[${m.category}] ${m.content.slice(0, 200)}`).join('\n');
  return { success: true, output: `Recalled ${limited.length} memories:\n${formatted}`, tokensUsed: 0 };
}


export async function executeAction(type: string, action: any, context: StepContext, ctx: StepExecutorContext): Promise<string> {
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
      if (!ctx.canWrite) {
        return `[Allow Graph Edits OFF] Would ${action.action}: ${action.content || action.pageName || 'block operation'}`;
      }
      if (action.action === 'createPage') {
        const page = await logseq.Editor.createPage(action.pageName, {}, { journal: false, redirect: false });
        if (page) {
          context.createdPages.push(action.pageName);
          const blockContent = action.content || action.pageName;
          const block = await logseq.Editor.insertBlock(page.uuid, blockContent, { sibling: false });
          if (block) context.createdBlockUUIDs.push(block.uuid);
          return `📄 Created new page: "${action.pageName}" and wrote block: "${blockContent}"`;
        }
        return `Failed to create page: "${action.pageName}"`;
      }

      // For insert: if no parentBlockUUID provided, auto-create a page and insert there
      if (action.action === 'insert' && !action.parentBlockUUID && action.content) {
        const autoPageName = context.goal.length > 50 ? context.goal.slice(0, 50) + '…' : context.goal;
        const page = await logseq.Editor.createPage(autoPageName, {}, { journal: false, redirect: false });
        if (page) {
          context.createdPages.push(autoPageName);
          const block = await logseq.Editor.insertBlock(page.uuid, action.content, { sibling: false });
          if (block) context.createdBlockUUIDs.push(block.uuid);
          return `📄 No page was open — created "${autoPageName}" and wrote block: "${action.content}"`;
        }
        throw new Error('Failed to create page for block insertion');
      }

      const cmd = { action: action.action, blockUUID: action.blockUUID, parentBlockUUID: action.parentBlockUUID, content: action.content };
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


export async function executeGatherStep(step: AgentStep, context: StepContext, ctx: StepExecutorContext): Promise<StepResult> {
  let totalTokens = 0;

  // Determine which pages to gather from prior step outputs
  const priorOutputs = context.previousOutputs.map(o => o.content).join('\n');

  // Ask LLM to extract page names from prior context
  const extractMessages: ChatMessage[] = [
    { role: 'system', content: 'Extract a JSON array of Logseq page names from the given context. Return ONLY a JSON array of strings, e.g. ["page1", "page2"]. If the context mentions page names, include them all. If no pages are mentioned, return an empty array [].' },
    { role: 'user', content: `Goal: ${context.goal}\nStep description: ${step.description}\n\nPrior context:\n${priorOutputs.slice(0, 4000)}` },
  ];

  const extractResult = await queryLiteLLM(extractMessages, ctx.settings.selectedModel, resolveApiKey(ctx.settings), resolveChatEndpoint(ctx.settings), ctx.signal, undefined, ctx.settings.chatProvider, ctx.settings.reasoningEffort);
  const extractRaw = extractResult.choices?.[0]?.message?.content?.trim() ?? '[]';
  totalTokens += countTokens(JSON.stringify(extractMessages)) + countTokens(extractRaw);

  let pageNames: string[] = [];
  try {
    const jsonMatch = extractRaw.match(/\[[\s\S]*\]/);
    pageNames = JSON.parse(jsonMatch ? jsonMatch[0] : extractRaw);
  } catch {
    pageNames = priorOutputs.split(/[\n,]/).map(s => s.trim()).filter(s => s.length > 0 && s.length < 100).slice(0, 30);
  }

  if (pageNames.length === 0) {
    return { success: true, output: 'No pages found to gather from.', tokensUsed: totalTokens };
  }

  // Process pages in batches
  const BATCH_SIZE = 3;
  const contextLimit = getContextLimitForModel(ctx.settings.selectedModel);
  const maxPageTokens = Math.floor(contextLimit * 0.5);
  const summaries: string[] = [];

  for (let i = 0; i < pageNames.length; i += BATCH_SIZE) {
    if (ctx.signal?.aborted) break;
    if (ctx.tokenBudget > 0 && ctx.tokensUsed + totalTokens >= ctx.tokenBudget) break;

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

    const batchResult = await queryLiteLLM(summarizeMessages, ctx.settings.selectedModel, resolveApiKey(ctx.settings), resolveChatEndpoint(ctx.settings), ctx.signal, undefined, ctx.settings.chatProvider, ctx.settings.reasoningEffort);
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

  const outputSummary = fullGatheredData
    ? `Gathered and summarized ${pageNames.length} pages in ${Math.ceil(pageNames.length / BATCH_SIZE)} batches. Pages: ${pageNames.join(', ')}\n\n${fullGatheredData}`
    : `Gathered 0 results from ${pageNames.length} pages. Pages may not exist or may be empty.`;
  return { success: true, output: outputSummary, tokensUsed: totalTokens };
}


export async function executeSpecialistStep(step: AgentStep, context: StepContext, ctx: StepExecutorContext): Promise<StepResult> {
  const specialistRole = step.specialistRole || 'You are a specialist agent. Produce the output described in the task using ONLY the provided input data.';

  // Gather targeted input — only from specified steps, not the full accumulation
  let inputData = '';
  if (step.inputSteps && step.inputSteps.length > 0) {
    const selectedOutputs = context.previousOutputs.filter(o => step.inputSteps!.includes(o.stepId));
    inputData = selectedOutputs.map(o => `[From step ${o.stepId}]:\n${o.content}`).join('\n\n---\n\n');
  }

  // Also include relevant scratchPad data if available
  if (context.scratchPad.size > 0) {
    const contextLimit = getContextLimitForModel(ctx.settings.selectedModel);
    const scratchBudget = Math.floor(contextLimit * 0.4);
    const entries = Array.from(context.scratchPad.entries())
      .map(([key, value]) => `[${key}]:\n${value}`)
      .join('\n\n');
    const scratchData = countTokens(entries) > scratchBudget
      ? decode(encode(entries).slice(0, scratchBudget))
      : entries;
    if (scratchData) {
      inputData += (inputData ? '\n\n---\n\n' : '') + '[Gathered data]:\n' + scratchData;
    }
  }

  // If no specific inputs were selected, provide a brief summary of what's been done
  if (!inputData) {
    inputData = context.previousOutputs.length > 0
      ? context.previousOutputs.map(o => `Step ${o.stepId}: ${o.content.slice(0, 200)}`).join('\n')
      : '(No prior data available)';
  }

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `${specialistRole}

RULES:
- Produce ONLY the output described in the task — not plans, outlines, or meta-commentary
- Use the provided input data as your source material
- Be thorough and complete — include all relevant information from the input
- If the task asks for a specific format (table, list, summary), produce it exactly`,
    },
    {
      role: 'user',
      content: `Goal: ${context.goal}\n\nTask: ${step.description}\n\n--- Input Data ---\n${inputData}\n\n--- End Input ---\n\nProduce the output now:`,
    },
  ];

  // Determine tool access level — default is 'read-only'
  const toolAccess = step.specialistTools ?? 'read-only';

  let raw: string;
  let tokens: number;

  if (toolAccess === 'none') {
    const result = await queryLiteLLM(messages, ctx.settings.selectedModel, resolveApiKey(ctx.settings), resolveChatEndpoint(ctx.settings), ctx.signal, undefined, ctx.settings.chatProvider, ctx.settings.reasoningEffort);
    raw = result.choices?.[0]?.message?.content?.trim() ?? '';
    tokens = countTokens(JSON.stringify(messages)) + countTokens(raw);
  } else {
    const remainingBudget = ctx.tokenBudget > 0 ? Math.max(0, ctx.tokenBudget - ctx.tokensUsed) : 0;
    const reactResult = await runReActLoop(messages, {
      settings: ctx.settings,
      signal: ctx.signal,
      maxIterations: 5,
      tokenBudget: remainingBudget,
      includeLogseqTools: true,
      includeLogseqWriteTools: toolAccess === 'full',
    });

    raw = reactResult.answer;
    if (reactResult.toolCalls.length > 0) {
      const toolSummary = reactResult.toolCalls
        .map(tc => `[Tool: ${tc.tool}] ${tc.result.slice(0, 200)}`)
        .join('\n');
      raw += '\n\n--- Tool Results ---\n' + toolSummary;
    }
    tokens = reactResult.tokensUsed;
  }

  // Store specialist output in scratchPad for downstream use
  const specialistKey = `specialist_step_${step.id}`;
  context.scratchPad.set(specialistKey, raw);

  return { success: !!raw, output: raw, tokensUsed: tokens };
}


// Forward declaration — AgentLoop class import is circular, so we accept a factory
export type AgentLoopFactory = (opts: any) => { generatePlan: (goal: string, context: string) => Promise<any>; run: (plan: any) => Promise<void> };

let _agentLoopFactory: AgentLoopFactory | null = null;

export function setAgentLoopFactory(factory: AgentLoopFactory): void {
  _agentLoopFactory = factory;
}

export async function executeSubGoalStep(step: AgentStep, context: StepContext, ctx: StepExecutorContext, emit: (type: ProgressEventType, step: AgentStep | undefined, message: string, completed: number, total: number) => void): Promise<StepResult> {
  // If at max depth, downgrade to specialist
  if (ctx.depth >= ctx.maxDepth) {
    return executeSpecialistStep(step, context, ctx);
  }

  const completedCount = context.previousOutputs.length;
  const totalSteps = completedCount + 1;
  emit('subgoal_start', step, `Starting sub-goal: ${step.description}`, completedCount, totalSteps);

  const childMaxDepth = step.subgoalConfig?.maxDepth ?? ctx.maxDepth;
  const childCanWrite = step.subgoalConfig?.canWrite ?? false;
  const childBudget = ctx.tokenBudget > 0 ? Math.max(0, ctx.tokenBudget - ctx.tokensUsed) : 0;

  if (!_agentLoopFactory) {
    return { success: false, output: '', tokensUsed: 0, error: 'AgentLoop factory not registered for sub-goals' };
  }

  const child = _agentLoopFactory({
    settings: ctx.settings,
    signal: ctx.signal,
    tokenBudget: childBudget,
    maxRetries: ctx.maxRetries,
    canWrite: childCanWrite,
    depth: ctx.depth + 1,
    maxDepth: childMaxDepth,
    onProgress: (event: any) => {
      ctx.onProgress({ ...event, message: `[Sub-goal] ${event.message}` });
    },
    onEscalate: ctx.onEscalate,
    onReplanProposed: async () => true,
  });

  // Build context for child from inputSteps
  let childContext = '';
  if (step.inputSteps && step.inputSteps.length > 0) {
    const selectedOutputs = context.previousOutputs.filter(o => step.inputSteps!.includes(o.stepId));
    childContext = selectedOutputs.map(o => `Step ${o.stepId}: ${o.content}`).join('\n\n');
  }
  const contextForChild = childContext || context.previousOutputs.slice(-3).map(o => `Step ${o.stepId}: ${o.content.slice(0, 500)}`).join('\n');

  const plan = await child.generatePlan(step.description, contextForChild);

  // Limit steps if configured
  if (step.subgoalConfig?.maxSteps && plan.steps.length > step.subgoalConfig.maxSteps) {
    plan.steps = plan.steps.slice(0, step.subgoalConfig.maxSteps);
  }

  await child.run(plan);

  // Extract final output from child
  const completedSteps = plan.steps.filter((s: any) => s.status === 'done');
  const lastOutput = completedSteps[completedSteps.length - 1]?.output || '';
  const tokensUsed = plan.steps.reduce((sum: number, s: any) => sum + (s.tokensUsed || 0), 0);
  ctx.addTokens(tokensUsed);

  emit('subgoal_complete', step, `Sub-goal completed: ${step.description}`, completedCount + 1, totalSteps);

  return { success: !!lastOutput, output: lastOutput, tokensUsed };
}


export async function executeStep(step: AgentStep, context: StepContext, ctx: StepExecutorContext, emit: (type: ProgressEventType, step: AgentStep | undefined, message: string, completed: number, total: number) => void): Promise<StepResult> {
  const contextLimit = getContextLimitForModel(ctx.settings.selectedModel);
  const isLastStep = context.previousOutputs.length >= 1 && step.type === 'think';
  const maxOutputLen = isLastStep ? Math.min(Math.floor(contextLimit * 0.3), 30000) : Math.min(Math.floor(contextLimit * 0.1), 8000);
  const maxPriorSteps = isLastStep ? context.previousOutputs.length : Math.min(context.previousOutputs.length, Math.max(5, Math.floor(contextLimit / 10000)));
  const contextSummary = context.previousOutputs.slice(-maxPriorSteps).map(o => `Step ${o.stepId}: ${o.content.slice(0, maxOutputLen)}`).join('\n\n');

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
    return await executeGatherStep(step, context, ctx);
  }

  // Recall: retrieve relevant memories from the memory store
  if (step.type === 'recall') {
    return await executeRecallStep(step, context, ctx);
  }

  // Specialist: isolated LLM call with focused context (no accumulated noise)
  if (step.type === 'specialist') {
    return await executeSpecialistStep(step, context, ctx);
  }

  // Subgoal: spawn an independent child agent with its own plan/execute cycle
  if (step.type === 'subgoal') {
    return await executeSubGoalStep(step, context, ctx, emit);
  }

  // For tool and search steps, use the full ReAct loop for iterative chaining
  if (step.type === 'tool' || step.type === 'search') {
    let focusedBlockContext = '';
    try {
      const currentBlock = await logseq.Editor.getCurrentBlock();
      if (currentBlock) {
        focusedBlockContext = `\nCurrent/Focused Block UUID: "${currentBlock.uuid}"\nCurrent/Focused Block Content: "${currentBlock.content || ''}"\n(When the user says "this block", "current block", or "selected block", they mean the block above. Its sub-blocks are the blocks indented one level deeper directly beneath it in the tool results.)\n`;
      }
    } catch { /* ignore */ }
    const stepMermaidRules = isDiagramIntent(step.description) || isDiagramIntent(context.goal) ? DIAGRAM_RULES : '';
    const messages: ChatMessage[] = [
      { role: 'system', content: STEP_SYSTEM_PROMPT + stepMermaidRules },
      { role: 'user', content: `Goal: ${context.goal}\nPrevious context:\n${contextSummary}${scratchPadContext}${focusedBlockContext}\n\nCurrent step: ${step.description}\n\nUse the available tools to accomplish this step. Call as many tools as needed.` },
    ];
    const reactResult = await runReActLoop(messages, {
      settings: ctx.settings,
      signal: ctx.signal,
      maxIterations: 10,
      tokenBudget: ctx.tokenBudget > 0 ? Math.max(0, ctx.tokenBudget - ctx.tokensUsed) : 0,
      includeLogseqTools: true,
      includeLogseqWriteTools: false,
    });
    const toolResultsSummary = reactResult.toolCalls
      .map(tc => `[${tc.tool}] ${tc.result.slice(0, 800)}`)
      .join('\n');
    const fullOutput = toolResultsSummary
      ? `${reactResult.answer}\n\n--- Tool Results ---\n${toolResultsSummary}`
      : reactResult.answer;
    return { success: true, output: fullOutput, tokensUsed: reactResult.tokensUsed };
  }

  // For read, write, think steps: single LLM call + action
  let writeContext = '';
  if (step.type === 'write') {
    try {
      let page = await logseq.Editor.getCurrentPage();
      const currentBlock = await logseq.Editor.getCurrentBlock();
      if (!page) {
        if (currentBlock?.page) page = await logseq.Editor.getPage(currentBlock.page.id);
      }
      const pageName = page ? String((page as any).name || (page as any).uuid || '') : '';
      if (page && (pageName.startsWith('Mixer/') || pageName.startsWith('mixer/'))) {
        page = null;
      }
      if (page) {
        const blocks = await logseq.Editor.getPageBlocksTree(pageName);
        const formatBlock = (b: any, depth = 0): string => {
          const indent = '  '.repeat(depth);
          let text = `${indent}[uuid:${b.uuid}] ${b.content}\n`;
          if (b.children) {
            for (const child of b.children) text += formatBlock(child, depth + 1);
          }
          return text;
        };
        const tree = blocks?.map((b: any) => formatBlock(b)).join('') || '(empty page)';
        writeContext = `\n\nCurrent page: "${pageName}"\nPage UUID: "${(page as any).uuid}" (use as parentBlockUUID to insert top-level blocks)\n`;
        if (currentBlock) {
          writeContext += `Current/Focused Block UUID: "${currentBlock.uuid}"\nCurrent/Focused Block Content: "${currentBlock.content || ''}"\n(When the user says "this block", "current block", or "selected block", they mean the block above. Its sub-blocks are the blocks indented one level deeper directly beneath it in the tree below.)\n`;
        }
        writeContext += `Block tree (indentation = sub-blocks/children of the parent above):\n${tree}`;
      } else {
        writeContext = `\n\nNOTE: No page is currently open/selected. Just use {"action":"insert","content":"<your content>"} — the system will automatically create a new page and insert the block there.`;
      }
    } catch { /* ignore */ }
  }

  const mermaidRules = isDiagramIntent(step.description) || isDiagramIntent(context.goal) ? DIAGRAM_RULES : '';
  const messages: ChatMessage[] = [
    { role: 'system', content: STEP_SYSTEM_PROMPT + mermaidRules },
    { role: 'user', content: `Goal: ${context.goal}\nPrevious context:\n${contextSummary}${scratchPadContext}${writeContext}\n\nCurrent step (type=${step.type}): ${step.description}\n\n${step.type === 'think' ? 'Using ALL the data above — especially the "Gathered Data (Working Memory)" section if present — produce the COMPLETE output described in this step. Write the actual content (table, analysis, summary, etc.) — not a plan or outline for how to produce it.' : 'Provide the JSON action to execute.'}` },
  ];

  const result = await queryLiteLLM(messages, ctx.settings.selectedModel, resolveApiKey(ctx.settings), resolveChatEndpoint(ctx.settings), ctx.signal, undefined, ctx.settings.chatProvider, ctx.settings.reasoningEffort);
  const raw = result.choices?.[0]?.message?.content?.trim() ?? '';
  const tokens = countTokens(JSON.stringify(messages)) + countTokens(raw);

  if (step.type === 'think') {
    return { success: true, output: raw, tokensUsed: tokens };
  }

  // Try to parse as JSON action; if LLM returned natural language instead, treat as analysis
  const jsonMatch = raw.match(/\[[\s\S]*\]/) || raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { success: true, output: raw, tokensUsed: tokens };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (Array.isArray(parsed)) {
      const results: string[] = [];
      for (const action of parsed) {
        const output = await executeAction(step.type, action, context, ctx);
        results.push(output);
      }
      return { success: true, output: results.join('\n'), tokensUsed: tokens };
    }
    const output = await executeAction(step.type, parsed, context, ctx);
    return { success: true, output, tokensUsed: tokens };
  } catch (err: any) {
    if (err instanceof SyntaxError) {
      return { success: true, output: raw, tokensUsed: tokens };
    }
    return { success: false, output: raw, tokensUsed: tokens, error: err.message || String(err) };
  }
}
