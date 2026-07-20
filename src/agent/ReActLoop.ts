import { queryLiteLLM, queryLiteLLMStreaming, resolveChatEndpoint, type ChatMessage } from 'LLMManager';
import { countTokens } from 'tokenizer';
import { MCPManager } from 'mcp/MCPManager';
import { executeLogseqTool, LOGSEQ_TOOLS } from './logseqTools';

export interface ReActOptions {
  settings: any;
  signal?: AbortSignal;
  maxIterations: number;
  tokenBudget: number;
  tools?: any[];
  includeLogseqTools?: boolean;
  includeLogseqWriteTools?: boolean;
  onThought?: (thought: string, iteration: number) => void;
  onToolCall?: (tool: string, args: any, result: string, iteration: number) => void;
  onChunk?: (chunk: string) => void;
  streamingEnabled?: boolean;
}

export interface ReActResult {
  answer: string;
  thoughts: Array<{ iteration: number; thought: string }>;
  toolCalls: Array<{ iteration: number; tool: string; args: any; result: string }>;
  tokensUsed: number;
  iterations: number;
}

const REACT_INSTRUCTION = `\n\nWhen using tools to solve problems:
1. THINK: Briefly reason about what information you need.
2. ACT: Call the appropriate tool(s).
3. OBSERVE: Analyze the results.
4. DECIDE: Either call more tools for additional information, or provide your final answer.
You may chain multiple tool calls iteratively until you have enough information to answer fully.`;

/**
 * Run a ReAct (Reason → Act → Observe) loop.
 * Iteratively calls tools until the LLM provides a final answer or limits are hit.
 */
export async function runReActLoop(
  messages: ChatMessage[],
  opts: ReActOptions
): Promise<ReActResult> {
  const { settings, signal, maxIterations, tokenBudget } = opts;
  const thoughts: ReActResult['thoughts'] = [];
  const toolCalls: ReActResult['toolCalls'] = [];
  let tokensUsed = 0;
  let iterations = 0;

  // Merge MCP tools + optional Logseq tools
  const mcpTools = opts.tools ?? MCPManager.getInstance().getEnabledTools();
  const LOGSEQ_WRITE_TOOL_NAMES = ['logseq_insert_block', 'logseq_update_block', 'logseq_create_page'];
  const logseqToolsFiltered = opts.includeLogseqTools !== false
    ? LOGSEQ_TOOLS.filter(t =>
        opts.includeLogseqWriteTools !== false || !LOGSEQ_WRITE_TOOL_NAMES.includes(t.function.name)
      )
    : [];
  const allTools = [...mcpTools, ...logseqToolsFiltered];

  // Determine whether to use streaming.
  // Stream the final answer only (when no tool_calls are returned).
  const useStreaming = opts.streamingEnabled && !!opts.onChunk;

  // Inject ReAct instruction into the system message if tools are available
  if (allTools.length > 0 && messages.length > 0 && messages[0].role === 'system') {
    messages = [...messages];
    messages[0] = { ...messages[0], content: (messages[0].content as string) + REACT_INSTRUCTION };
  }

  // Helper: call LLM with or without streaming.
  // When streaming, onChunk is only forwarded if isFinalCandidate is true.
  // Since we can't know ahead of time if a call will have tool_calls, we
  // use a two-pass strategy:
  //   - If no tools are available (simple Q&A), stream the first call directly.
  //   - If tools are available, use non-streaming for reliability during tool iterations,
  //     then stream the final answer once we detect no more tool calls.
  const hasTools = allTools.length > 0;

  // Initial LLM call
  let llmOutput: any;
  if (useStreaming && !hasTools) {
    // Simple Q&A with no tools: stream directly
    llmOutput = await queryLiteLLMStreaming(messages, settings.selectedModel, settings.apiKey, resolveChatEndpoint(settings), opts.onChunk!, signal, undefined, settings.chatProvider);
  } else {
    llmOutput = await queryLiteLLM(messages, settings.selectedModel, settings.apiKey, resolveChatEndpoint(settings), signal, allTools.length > 0 ? allTools : undefined, settings.chatProvider);
  }
  let assistantMessage = llmOutput.choices?.[0]?.message;
  tokensUsed += estimateTokens(messages, assistantMessage?.content || '', allTools);

  if (!assistantMessage) {
    throw new Error('No response message received from LiteLLM.');
  }

  // ReAct loop: iterate while the LLM wants to call tools
  while (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0 && iterations < maxIterations) {
    iterations++;

    if (signal?.aborted) break;
    if (tokenBudget > 0 && tokensUsed >= tokenBudget) break;

    // Extract thought from assistant content (if any)
    const thought = assistantMessage.content?.trim() || '';
    if (thought) {
      thoughts.push({ iteration: iterations, thought });
      opts.onThought?.(thought, iterations);
    }

    // Append assistant message with tool calls
    messages.push({
      role: 'assistant',
      content: thought,
      tool_calls: assistantMessage.tool_calls,
    });

    // Execute all tool calls
    for (const toolCall of assistantMessage.tool_calls) {
      const funcName = toolCall.function.name;
      let args: any = {};
      try {
        args = typeof toolCall.function.arguments === 'string'
          ? JSON.parse(toolCall.function.arguments)
          : toolCall.function.arguments;
      } catch {
        args = {};
      }

      let toolResult = '';
      try {
        if (funcName.startsWith('logseq_')) {
          toolResult = await executeLogseqTool(funcName, args);
        } else {
          toolResult = await MCPManager.getInstance().executeToolCall(funcName, args);
        }
      } catch (err: any) {
        toolResult = `Error: ${err.message || err}`;
      }

      toolCalls.push({ iteration: iterations, tool: funcName, args, result: toolResult });
      opts.onToolCall?.(funcName, args, toolResult, iterations);

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        name: funcName,
        content: toolResult,
      });
    }

    // Compress older messages if approaching context limit
    if (iterations > 3) {
      const totalTokens = estimateTokens(messages, '', allTools);
      const contextLimit = 100000;
      if (totalTokens > contextLimit * 0.7) {
        const keepFromIdx = messages.length - 6;
        for (let i = 2; i < Math.max(2, keepFromIdx); i++) {
          const msg = messages[i];
          if (msg.role === 'tool' && msg.content && msg.content.length > 200) {
            messages[i] = { ...msg, content: msg.content.slice(0, 200) + '\n... (truncated)' };
          }
        }
      }
    }

    // Query LLM again with updated context.
    // Use streaming for the next call: if the response has no tool_calls, it's the final answer.
    // We use a conditional chunk collector — stream chunks, but only forward to UI
    // if no tool_calls are detected (which we know after the stream finishes).
    if (useStreaming) {
      let pendingChunks: string[] = [];
      llmOutput = await queryLiteLLMStreaming(messages, settings.selectedModel, settings.apiKey, resolveChatEndpoint(settings), (chunk) => {
        pendingChunks.push(chunk);
      }, signal, allTools, settings.chatProvider);
      assistantMessage = llmOutput.choices?.[0]?.message;
      // If this was the final answer (no tool_calls), flush accumulated chunks to the UI
      if (!assistantMessage?.tool_calls || assistantMessage.tool_calls.length === 0) {
        for (const chunk of pendingChunks) {
          opts.onChunk!(chunk);
        }
      }
    } else {
      llmOutput = await queryLiteLLM(messages, settings.selectedModel, settings.apiKey, resolveChatEndpoint(settings), signal, allTools, settings.chatProvider);
      assistantMessage = llmOutput.choices?.[0]?.message;
    }
    tokensUsed += estimateTokens([], assistantMessage?.content || '');

    if (!assistantMessage) {
      throw new Error('No response message received from LiteLLM after tool call.');
    }
  }

  const answer = assistantMessage.content || '';
  return { answer, thoughts, toolCalls, tokensUsed, iterations };
}

function estimateTokens(messages: ChatMessage[], response: string, tools?: any[]): number {
  let total = 0;
  for (const m of messages) {
    if (typeof m.content === 'string') total += countTokens(m.content);
    if ((m as any).tool_calls) {
      for (const tc of (m as any).tool_calls) {
        total += countTokens(tc.function?.arguments || '');
      }
    }
  }
  total += countTokens(response);
  if (tools?.length) total += tools.length * 100;
  return total;
}
