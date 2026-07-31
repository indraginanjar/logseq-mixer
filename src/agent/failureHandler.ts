import { queryLiteLLM, resolveChatEndpoint, resolveApiKey, type ChatMessage } from 'LLMManager';
import { countTokens } from 'tokenizer';
import type { AgentStep, StepContext } from './types';

export interface FailureHandlerContext {
  settings: any;
  signal?: AbortSignal;
  maxRetries: number;
  addTokens: (count: number) => void;
}

export async function handleFailure(step: AgentStep, error: string, attempt: number, ctx: FailureHandlerContext): Promise<'retry' | 'escalate' | 'skip'> {
  if ((step.type === 'read' || step.type === 'search') && /not found|empty|null/i.test(error)) return 'skip';
  if (attempt < ctx.maxRetries) return 'retry';
  return 'escalate';
}

export async function diagnoseFailure(step: AgentStep, error: string, context: StepContext, ctx: FailureHandlerContext): Promise<string> {
  try {
    const recentContext = context.previousOutputs.slice(-3).map(o => `Step ${o.stepId}: ${o.content.slice(0, 200)}`).join('\n');
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
    const result = await queryLiteLLM(messages, ctx.settings.selectedModel, resolveApiKey(ctx.settings), resolveChatEndpoint(ctx.settings), ctx.signal, undefined, ctx.settings.chatProvider, ctx.settings.reasoningEffort);
    const diagnostic = result.choices?.[0]?.message?.content?.trim() ?? '';
    const tokensUsed = countTokens(JSON.stringify(messages)) + countTokens(diagnostic);
    ctx.addTokens(tokensUsed);
    if (diagnostic) return diagnostic;
  } catch {
    // If diagnostic LLM call fails, fall back to raw error
  }
  return `Error: ${error}`;
}

export async function rollback(context: StepContext): Promise<void> {
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

export async function rollbackLastRun(currentContext: StepContext | null): Promise<{ message: string; cleared: boolean }> {
  if (!currentContext) return { message: 'Nothing to rollback', cleared: false };
  const pages = currentContext.createdPages.length;
  const blocks = currentContext.createdBlockUUIDs.length;
  if (pages === 0 && blocks === 0) return { message: 'Nothing to rollback', cleared: false };
  await rollback(currentContext);
  const msg = `Rolled back: ${pages} page(s) and ${blocks} block(s) removed`;
  return { message: msg, cleared: true };
}
