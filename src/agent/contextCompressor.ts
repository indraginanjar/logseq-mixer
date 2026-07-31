import { queryLiteLLM, resolveChatEndpoint, type ChatMessage } from 'LLMManager';
import { countTokens } from 'tokenizer';
import type { StepContext } from './types';

export interface CompressorContext {
  settings: any;
  signal?: AbortSignal;
  addTokens: (count: number) => void;
}

/**
 * Compress accumulated previous outputs into a concise working memory.
 * Called when accumulated context tokens exceed a threshold, preventing
 * attention degradation in subsequent steps.
 */
export async function compressContext(context: StepContext, ctx: CompressorContext): Promise<void> {
  const allOutputText = context.previousOutputs.map(o => o.content).join('\n');
  const totalTokens = countTokens(allOutputText);

  // Only compress if we have substantial accumulated context
  const COMPRESSION_THRESHOLD = 4000; // tokens
  if (totalTokens < COMPRESSION_THRESHOLD) return;

  try {
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `You are a context compression agent. Condense the following step outputs into a focused working memory.

RULES:
- Preserve ALL factual data: names, UUIDs, page names, block content, search results, numbers, dates
- Preserve the logical sequence of what was done and discovered
- Remove redundancy, verbose explanations, and repeated content
- Use structured bullet points for clarity
- Keep extracted data verbatim (don't paraphrase page names, UUIDs, or content)
- Output should be 30-50% of the original length while retaining all key information
- If a step produced a list of results, keep the list (compressed but complete)`,
      },
      {
        role: 'user',
        content: `Goal: ${context.goal}\n\nStep outputs to compress:\n${context.previousOutputs.map(o => `[Step ${o.stepId}]: ${o.content}`).join('\n\n---\n\n')}\n\nCompress into working memory:`,
      },
    ];

    const result = await queryLiteLLM(messages, ctx.settings.selectedModel, ctx.settings.apiKey, resolveChatEndpoint(ctx.settings), ctx.signal, undefined, ctx.settings.chatProvider, ctx.settings.reasoningEffort);
    const compressed = result.choices?.[0]?.message?.content?.trim() ?? '';
    const compressionTokens = countTokens(JSON.stringify(messages)) + countTokens(compressed);
    ctx.addTokens(compressionTokens);

    if (compressed && countTokens(compressed) < totalTokens * 0.8) {
      // Replace all previous outputs with the single compressed version
      const lastStepId = context.previousOutputs[context.previousOutputs.length - 1]?.stepId ?? 0;
      console.info(`[AgentLoop] Context compressed: ${totalTokens} → ${countTokens(compressed)} tokens (${context.previousOutputs.length} steps)`);
      context.previousOutputs = [{ stepId: lastStepId, type: 'data', content: `[Compressed working memory from steps 1-${lastStepId}]\n${compressed}` }];
    }
  } catch (err) {
    console.warn('[AgentLoop] Context compression failed, continuing with uncompressed context:', err);
  }
}
