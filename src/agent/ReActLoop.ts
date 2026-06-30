import { queryLiteLLM, type ChatMessage } from 'LLMManager';
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
  onThought?: (thought: string, iteration: number) => void;
  onToolCall?: (tool: string, args: any, result: string, iteration: number) => void;
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
  const allTools = opts.includeLogseqTools !== false
    ? [...mcpTools, ...LOGSEQ_TOOLS]
    : mcpTools;

  // Inject ReAct instruction into the system message if tools are available
  if (allTools.length > 0 && messages.length > 0 && messages[0].role === 'system') {
    messages = [...messages];
    messages[0] = { ...messages[0], content: (messages[0].content as string) + REACT_INSTRUCTION };
  }

  // Initial LLM call
  let llmOutput = await queryLiteLLM(messages, settings.selectedModel, settings.apiKey, settings.LiteLLMLink, signal, allTools.length > 0 ? allTools : undefined);
  let assistantMessage = llmOutput.choices?.[0]?.message;
  tokensUsed += estimateTokens(messages, assistantMessage?.content || '');

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

    // Query LLM again with updated context
    llmOutput = await queryLiteLLM(messages, settings.selectedModel, settings.apiKey, settings.LiteLLMLink, signal, allTools);
    assistantMessage = llmOutput.choices?.[0]?.message;
    tokensUsed += estimateTokens([], assistantMessage?.content || '');

    if (!assistantMessage) {
      throw new Error('No response message received from LiteLLM after tool call.');
    }
  }

  const answer = assistantMessage.content || '';
  return { answer, thoughts, toolCalls, tokensUsed, iterations };
}

function estimateTokens(messages: ChatMessage[], response: string): number {
  const msgText = messages.map(m => typeof m.content === 'string' ? m.content : '').join('');
  return countTokens(msgText + response);
}
