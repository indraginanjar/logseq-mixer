import { queryLiteLLM, resolveChatEndpoint, resolveApiKey, type ChatMessage } from 'LLMManager';
import { countTokens } from 'tokenizer';
import { MCPManager } from 'mcp/MCPManager';
import type { AgentPlan, AgentStep } from './types';

const PLAN_SYSTEM_PROMPT = `You are a planning agent for a Logseq knowledge management system. Break down the user's goal into atomic steps.

Available capabilities:
- read: Read a single Logseq page or get block trees
- write: Insert, update, or delete blocks in Logseq pages; create new pages
- search: Search the knowledge base using hybrid vector+keyword search
- tool: Use external MCP tools (if available)
- think: Analyze information and reason about next steps (also use this when you need to process data already available in the context)
- gather: Read MULTIPLE pages in batches, extracting and summarizing key information from each. Use this ONLY when the goal requires processing more than 3 DIFFERENT PAGES or collecting data across many sources.
- specialist: Execute a focused sub-task with ISOLATED context. The specialist receives ONLY the data from specific prior steps (via inputSteps) — not the full accumulated context. Use this for synthesis, comparison, or complex analysis tasks where accumulated context noise would degrade quality.
- subgoal: Spawn an independent sub-agent with its own plan/execute cycle. Use for complex sub-tasks that need autonomous multi-step reasoning. The sub-agent has read-only access by default.
- recall: Retrieve relevant observations and facts from the agent's persistent memory. Use when prior knowledge about the user's preferences or past interactions would help.

Respond with ONLY valid JSON in this format:
{"steps":[{"id":1,"description":"...","type":"read|write|search|tool|think|gather|specialist|subgoal|recall","specialistRole":"(optional) system instruction for the specialist","inputSteps":[1,2]}],"estimatedTokens":NUMBER}

PLANNING RULES:
- IMPORTANT: The "Current context" below already contains the current page's FULL block tree with UUIDs, AND the user's focused/selected block with its UUID. You do NOT need a "read" or "gather" step to access sub-blocks of the current block — they are ALREADY in the context. Use a "think" step to analyze them, then "write" steps to modify them.
- Use "gather" ONLY when the goal involves reading/processing MULTIPLE DIFFERENT PAGES (e.g., "find all pages about X and extract Y", "summarize my notes on Z"). Do NOT use "gather" for reading sub-blocks of the current block.
- Use "read" only when you need to read a DIFFERENT page than the one already in context.
- Use "think" to process, analyze, or extract information from data already in context (including sub-blocks of the current block).
- Use "specialist" for the FINAL synthesis/output step when the goal requires combining data from multiple prior steps (search + gather → specialist synthesizes). Also use specialist when you need high-quality output that would be degraded by large accumulated context. Specify "inputSteps" to tell the specialist which step outputs to use as input.
- A gather step description should specify WHAT to look for and WHAT to extract. Example: "Gather all machine learning pages and extract key concepts, definitions, and relationships from each."
- Use "search" first to find relevant pages, then "gather" to process them in bulk.
- Keep steps atomic and sequential. Estimate total tokens needed for all LLM calls.

WRITE STEP RESTRICTIONS (CRITICAL):
- Use "write" steps ONLY when the user's goal EXPLICITLY asks to create, insert, update, modify, or delete content in their graph.
- NEVER use "write" steps for: answering questions, summarizing, analyzing, explaining, listing, comparing, or presenting information. These should use "think" or "specialist" steps — the output goes to the chat response automatically.
- The FINAL step of a plan should almost NEVER be a "write" step unless the user specifically asked for content to be written to a page. Summaries, analyses, and answers belong in the chat, not written to the graph.
- When in doubt, use "think" instead of "write". The user can always manually edit later.
- A plan should have AT MOST 1-2 "write" steps, and only for the specific content the user asked to be written. Intermediate results (search results, analyses, etc.) should NEVER be written to the graph.`;

export interface PlanGeneratorContext {
  settings: any;
  signal?: AbortSignal;
  canWrite: boolean;
}

/**
 * Generate an execution plan from a user goal and context.
 * Returns token count consumed by this call.
 */
export async function generatePlan(
  goal: string,
  context: string,
  ctx: PlanGeneratorContext
): Promise<{ plan: AgentPlan; tokensUsed: number }> {
  const tools = MCPManager.getInstance().getEnabledTools();
  const toolList = tools.length > 0
    ? `\nAvailable MCP tools: ${tools.map((t: any) => t.function.name).join(', ')}`
    : '';
  const writeConstraint = !ctx.canWrite
    ? '\n\nIMPORTANT: Direct Page Edit mode is OFF. Do NOT create pages or write/insert/update blocks in Logseq. Only gather information and present the results as text output. All output should be delivered in the chat response, not written to the graph.'
    : '';

  // Build environment context for the planner
  const planNow = new Date();
  const planDate = planNow.toISOString().split('T')[0];
  const planDay = planNow.toLocaleDateString('en-US', { weekday: 'long' });
  const planTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  let planEnv = `\n\nCurrent date: ${planDate} (${planDay}), timezone: ${planTz}.`;
  try {
    const configs = await logseq.App.getUserConfigs();
    if (configs.preferredDateFormat) planEnv += ` Logseq journal date format: "${configs.preferredDateFormat}".`;
  } catch { /* ignore */ }

  const messages: ChatMessage[] = [
    { role: 'system', content: PLAN_SYSTEM_PROMPT + toolList + writeConstraint + planEnv },
    { role: 'user', content: `Goal: ${goal}\n\nCurrent context:\n${context}` },
  ];

  const result = await queryLiteLLM(messages, ctx.settings.selectedModel, resolveApiKey(ctx.settings), resolveChatEndpoint(ctx.settings), ctx.signal, undefined, ctx.settings.chatProvider, ctx.settings.reasoningEffort);
  const raw = result.choices?.[0]?.message?.content?.trim() ?? '';
  const tokensUsed = countTokens(JSON.stringify(messages)) + countTokens(raw);

  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    let steps: AgentStep[] = (parsed.steps || []).map((s: any, i: number) => ({
      id: s.id ?? i + 1,
      description: s.description,
      type: s.type || 'think',
      tool: s.tool,
      specialistRole: s.specialistRole,
      inputSteps: s.inputSteps,
      status: 'pending' as const,
    }));
    // Sanitize: downgrade excessive write steps when the goal doesn't warrant them
    steps = sanitizeWriteSteps(steps, goal);
    return { plan: { goal, steps, estimatedTokens: parsed.estimatedTokens || 50000 }, tokensUsed };
  } catch {
    return { plan: { goal, steps: [{ id: 1, description: goal, type: 'think', status: 'pending' }], estimatedTokens: 10000 }, tokensUsed };
  }
}

/**
 * Downgrade excessive "write" steps to "think" when the user's goal doesn't
 * explicitly ask for content to be written, created, or modified in the graph.
 *
 * This prevents overly aggressive models (e.g. GPT-5) from writing intermediate
 * results, analyses, or summaries directly to Logseq pages when the user only
 * asked a question or requested a summary in chat.
 */
export function sanitizeWriteSteps(steps: AgentStep[], goal: string): AgentStep[] {
  // Detect whether the goal explicitly requests writing to the graph
  const goalLower = goal.toLowerCase();
  const WRITE_INTENT_PATTERNS = [
    /\b(create|make|add|insert|write|put|build|generate)\b.{0,30}\b(page|block|note|entry|bullet|item|section|outline)\b/,
    /\b(update|edit|modify|change|rewrite|revise|fix|correct)\b.{0,30}\b(page|block|note|entry|content)\b/,
    /\b(delete|remove|clear)\b.{0,30}\b(page|block|note|entry)\b/,
    /\bcreate\b.{0,20}\b(overview|summary|index|toc|table of contents)\b/,
    /\bwrite\s+(it|this|that|the result|the output)\s+(to|in|into|on)\b/,
    /\b(save|store|record)\b.{0,20}\b(to|in|into|on)\b.{0,20}\b(page|block|graph|logseq)\b/,
    /\bstructured?\s+overview\b.*\blink/,
  ];

  const hasWriteIntent = WRITE_INTENT_PATTERNS.some(p => p.test(goalLower));

  if (hasWriteIntent) {
    // Goal explicitly asks for writes — allow up to 3 write steps max
    const MAX_WRITE_STEPS = 3;
    let writeCount = 0;
    return steps.map(step => {
      if (step.type === 'write') {
        writeCount++;
        if (writeCount > MAX_WRITE_STEPS) {
          return { ...step, type: 'think' as const };
        }
      }
      return step;
    });
  }

  // Goal does NOT explicitly request writes — downgrade ALL write steps to think
  return steps.map(step => {
    if (step.type === 'write') {
      return { ...step, type: 'think' as const };
    }
    return step;
  });
}
