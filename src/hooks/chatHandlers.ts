import { ChatMessage } from 'components/ChatMessageList';
import { MemoryStore } from '../memory/MemoryStore';
import { pendingAgentGoal, clearPendingAgentGoal, getPendingAgentHandoff, clearPendingAgentHandoff } from '../manager';
import { AgentLoop } from '../agent/AgentLoop';
import type { AgentProgressEvent, AgentStep } from '../agent/types';
import { addToConversationHistory, handleQuery } from 'manager';
import { answerHelpQuestion } from '../helpSystem';
import { listBuiltInTools } from '../toolsCommand';
import { extractRawPrompt, sendRawPrompt } from '../rawCommand';
import { executeAll, verifyAndCorrect } from '../blockExecutor';
import { getActivePageContext } from '../blockTreeFormatter';
import type { StorageProvider } from '../storage/StorageProvider';
import type { ExecutionResult } from '../types/editTypes';
import type { AgentController } from './useAgentController';
import { getLastMemorySaved } from '../manager';
import { getQueryTokenUsage } from '../storage/logTokenUsage';

interface Settings {
  selectedModel?: string;
  chatProvider?: string;
  chatEndpoint?: string;
  openaiEndpoint?: string;
  ollamaEndpoint?: string;
  litellmEndpoint?: string;
  LiteLLMLink?: string;
  apiKey?: string;
  openaiApiKey?: string;
  ollamaApiKey?: string;
  litellmApiKey?: string;
  reasoningEffort?: string;
  streamingEnabled?: boolean;
  memoryEnabled?: boolean;
  autoSummarize?: boolean;
  agentTokenBudget?: number;
  agentMaxRetries?: number;
  agentAutonomy?: string;
  agentVerboseMode?: boolean;
  agentPersistVerboseToChat?: boolean;
  [key: string]: any;
}

type SetMessages = React.Dispatch<React.SetStateAction<ChatMessage[]>>;
type SetLoading = React.Dispatch<React.SetStateAction<boolean>>;
type SetThinkingText = React.Dispatch<React.SetStateAction<string | null>>;
type SetError = React.Dispatch<React.SetStateAction<string | null>>;
type SetEditResults = React.Dispatch<React.SetStateAction<Map<string | number, ExecutionResult>>>;

/** Format current time as ISO-like timestamp for chat message headers. */
function chatTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

/**
 * Handle /help command flow.
 */
export async function handleHelpCommand(
  message: string,
  settings: Settings,
  setMessages: SetMessages,
  setLoading: SetLoading,
  setThinkingText: SetThinkingText,
): Promise<void> {
  try {
    const helpResponse = await answerHelpQuestion(message, settings);
    setMessages(prev => [...prev, { id: Date.now() + '_help', content: helpResponse, sender: 'assistant', model: settings?.selectedModel, timestamp: chatTimestamp() }]);
  } catch (err: any) {
    throw err;
  } finally {
    setLoading(false);
    setThinkingText(null);
  }
}

/**
 * Handle /tools command flow.
 */
export function handleToolsCommand(
  setMessages: SetMessages,
  setLoading: SetLoading,
  setThinkingText: SetThinkingText,
): void {
  const toolsResponse = listBuiltInTools();
  setMessages(prev => [...prev, { id: Date.now() + '_tools', content: toolsResponse, sender: 'assistant', timestamp: chatTimestamp() }]);
  setLoading(false);
  setThinkingText(null);
}

/**
 * Handle /raw command flow.
 */
export async function handleRawCommand(
  message: string,
  settings: Settings,
  abortControllerRef: React.MutableRefObject<AbortController | null>,
  setMessages: SetMessages,
  setLoading: SetLoading,
  setThinkingText: SetThinkingText,
  setError: SetError,
): Promise<void> {
  const rawPrompt = extractRawPrompt(message);
  try {
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const rawResponse = await sendRawPrompt(rawPrompt, settings, controller.signal);
    abortControllerRef.current = null;
    setMessages(prev => [...prev, { id: Date.now() + '_raw', content: rawResponse, sender: 'assistant', model: settings?.selectedModel, timestamp: chatTimestamp() }]);
  } catch (err: any) {
    if (err.name !== 'AbortError') {
      setError(err.message || 'Raw command error');
    }
  } finally {
    setLoading(false);
    setThinkingText(null);
  }
}

export interface ChatQueryParams {
  message: string;
  settings: Settings;
  storageProvider: StorageProvider;
  aiEditMode: boolean;
  imageDataUrls: { name: string; content: string }[];
  attachedFiles: { name: string; content: string }[];
  abortControllerRef: React.MutableRefObject<AbortController | null>;
  setMessages: SetMessages;
  setLoading: SetLoading;
  setThinkingText: SetThinkingText;
  setError: SetError;
  setEditResults: SetEditResults;
  setMemoryCount: React.Dispatch<React.SetStateAction<number>>;
  memoryStoreInstance: MemoryStore | null;
  agentController: AgentController;
  verboseMode: boolean;
}

/**
 * Handle the main chat/edit/agent flow.
 */
export async function handleChatQuery(params: ChatQueryParams): Promise<void> {
  const {
    message,
    settings,
    storageProvider,
    aiEditMode,
    imageDataUrls,
    attachedFiles,
    abortControllerRef,
    setMessages,
    setLoading,
    setThinkingText,
    setError,
    setEditResults,
    setMemoryCount,
    memoryStoreInstance,
    agentController,
    verboseMode,
  } = params;

  const {
    setAgentPlan,
    agentPlanRef,
    setAgentRunning,
    setAgentTokensUsed,
    setEscalationQuestion,
    agentLoopRef,
    escalationResolverRef,
    setReplanReason,
    setReplanSteps,
    replanResolverRef,
    agentAbortRef,
  } = agentController;

  try {
    const controller = new AbortController();
    abortControllerRef.current = controller;

    // When edit mode is on, check for an active page first
    let effectiveEditMode = aiEditMode || undefined;
    if (aiEditMode) {
      const pageCtx = await getActivePageContext();
      if (!pageCtx) {
        effectiveEditMode = undefined;
        setMessages(prev => [...prev, {
          id: Date.now() + '_warning',
          content: '⚠️ No active page is open. Edit mode requires an open page to work. Sending query without edit context.',
          sender: 'assistant',
          timestamp: chatTimestamp(),
        }]);
      }
    }

    const attachedImages = imageDataUrls;
    const fileContexts = attachedFiles;
    const fileAppendix = fileContexts.length > 0
      ? '\n\n---\n' + fileContexts.map(f => `Attached file: ${f.name}\n\`\`\`\n${f.content}\n\`\`\``).join('\n\n')
      : '';
    const queryWithFile = message + fileAppendix;
    const streamingEnabled = settings.streamingEnabled !== false && !effectiveEditMode;
    const streamingMsgId = Date.now() + '_assistant';
    let isStreamingStarted = false;

    const onChunk = streamingEnabled ? (chunk: string) => {
      if (!isStreamingStarted) {
        isStreamingStarted = true;
        setLoading(false);
        setMessages(prev => [...prev, {
          id: streamingMsgId,
          content: chunk,
          sender: 'assistant',
          model: settings?.selectedModel,
          timestamp: chatTimestamp(),
        }]);
      } else {
        setMessages(prev => prev.map(m =>
          m.id === streamingMsgId ? { ...m, content: m.content + chunk } : m
        ));
      }
    } : undefined;

    const resp = await handleQuery(queryWithFile, settings, storageProvider, controller.signal, effectiveEditMode, attachedImages.length > 0 ? attachedImages.map(img => img.content) : undefined, onChunk);
    abortControllerRef.current = null;

    // Handle agent goal detection
    if (resp === '__AGENT_GOAL_DETECTED__' && pendingAgentGoal) {
      const goal = pendingAgentGoal;
      clearPendingAgentGoal();
      setLoading(true);
      const agentController2 = new AbortController();
      agentAbortRef.current = agentController2;
      const persistVerbose = verboseMode && (settings.agentPersistVerboseToChat as boolean);
      const loop = new AgentLoop({
        settings,
        signal: agentController2.signal,
        tokenBudget: settings.agentTokenBudget || 100000,
        maxRetries: settings.agentMaxRetries || 2,
        canWrite: aiEditMode,
        onProgress: (event: AgentProgressEvent) => {
          setAgentTokensUsed(event.tokensUsed);
          if (event.step) {
            setAgentPlan(prev => {
              const updated = prev ? { ...prev, steps: prev.steps.map(s => s.id === event.step!.id ? event.step! : s) } : prev;
              agentPlanRef.current = updated;
              return updated;
            });
          }

          // Stream completed step outputs to chat when verbose + persist is on
          if (persistVerbose && event.type === 'step_complete' && event.step?.output) {
            const badge = event.step.type === 'gather' ? '📥' : event.step.type === 'search' ? '🔍' : event.step.type === 'read' ? '📖' : event.step.type === 'write' ? '✏️' : event.step.type === 'tool' ? '🔧' : '💭';
            const stepMsg = `${badge} **Step ${event.step.id}** — ${event.step.description}\n\n${event.step.output}`;
            setMessages(prev => [...prev, {
              id: `agent_step_${event.step!.id}_${Date.now()}`,
              content: stepMsg,
              sender: 'assistant',
              model: settings?.selectedModel,
              timestamp: chatTimestamp(),
            }]);
          }
          if (persistVerbose && event.type === 'step_failed' && event.step?.error) {
            const failMsg = `❌ **Step ${event.step.id} failed** — ${event.step.description}\n\n${event.step.error}`;
            setMessages(prev => [...prev, {
              id: `agent_step_${event.step!.id}_fail_${Date.now()}`,
              content: failMsg,
              sender: 'assistant',
              timestamp: chatTimestamp(),
            }]);
          }
          if (persistVerbose && event.type === 'self_correcting' && event.step) {
            const correctMsg = `↩️ **Correcting step ${event.step.id}** — ${event.message}`;
            setMessages(prev => [...prev, {
              id: `agent_correct_${event.step!.id}_${Date.now()}`,
              content: correctMsg,
              sender: 'assistant',
              timestamp: chatTimestamp(),
            }]);
          }


          if (event.type === 'complete' || event.type === 'aborted') {
            setAgentRunning(false);
            setLoading(false);
            const currentPlan = agentPlanRef.current;
            if (currentPlan) {
              const completed = currentPlan.steps.filter(s => s.status === 'done').length;
              const failed = currentPlan.steps.filter(s => s.status === 'failed').length;
              const total = currentPlan.steps.length;
              const isAborted = event.type === 'aborted';

              const stepsSummary = currentPlan.steps.map(s => {
                const icon = s.status === 'done' ? '✓' : s.status === 'failed' ? '✗' : s.status === 'skipped' ? '→' : '○';
                const badge = s.type === 'gather' ? '📥' : s.type === 'search' ? '🔍' : s.type === 'read' ? '📖' : s.type === 'write' ? '✏️' : s.type === 'tool' ? '🔧' : '💭';
                const tokenInfo = persistVerbose && s.tokensUsed ? `  \`${Math.round(s.tokensUsed / 1000)}k tok\`` : '';
                return `| ${icon} | ${badge} ${s.description}${tokenInfo} |`;
              }).join('\n');

              const statusLine = isAborted
                ? `⚠️ *Stopped — ${completed}/${total} steps completed*`
                : failed > 0
                  ? `⚠️ *Completed with ${failed} failed step${failed > 1 ? 's' : ''} — ${completed}/${total} succeeded*`
                  : `✅ *All ${total} steps completed successfully*`;

              const tokenSummary = persistVerbose ? ` • ${Math.round(event.tokensUsed / 1000)}k tokens used` : '';

              const doneSteps = currentPlan.steps.filter(s => s.status === 'done' && s.output);
              const lastOutput = doneSteps.length > 0 ? doneSteps[doneSteps.length - 1].output : '';
              const finalAnswer = lastOutput ? `\n\n---\n\n${lastOutput}` : '';

              const messageContent = [
                `### 🤖 ${currentPlan.goal}`,
                '',
                '| | Step |',
                '|---|---|',
                stepsSummary,
                '',
                `${statusLine}${tokenSummary}`,
                finalAnswer,
              ].join('\n');

              setMessages(prev => [...prev, {
                id: `agent_${Date.now()}`,
                content: messageContent,
                sender: 'assistant',
                model: settings?.selectedModel,
                timestamp: chatTimestamp(),
              }]);
              const historyContent = persistVerbose
                ? doneSteps.map(s => `[Step ${s.id} - ${s.type}] ${s.description}:\n${s.output}`).join('\n\n')
                : (lastOutput || `Completed goal: ${currentPlan.goal}. ${event.message}`);
              addToConversationHistory('user', `[Agent goal]: ${currentPlan.goal}`);
              addToConversationHistory('assistant', historyContent);
            }
            setAgentPlan(null);
            agentPlanRef.current = null;
            if (event.type === 'complete' && memoryStoreInstance) {
              memoryStoreInstance.addMemory('task_outcome', `Goal: ${goal}\nResult: ${event.message}`, 'auto');
            }
          }
          if (event.type === 'replan_approved') {
            setReplanReason(null);
            setReplanSteps([]);
          }
        },
        onEscalate: (question: string) => new Promise<string>(resolve => {
          setEscalationQuestion(question);
          escalationResolverRef.current = resolve;
        }),
        onReplanProposed: (reason: string, newSteps: AgentStep[]) => new Promise<boolean>(resolve => {
          if (settings.agentAutonomy === 'autopilot') {
            resolve(true);
          } else {
            setReplanReason(reason);
            setReplanSteps(newSteps);
            replanResolverRef.current = resolve;
          }
        }),
      });
      agentLoopRef.current = loop;
      const pageCtx = await getActivePageContext();
      let ctxStr = '';
      if (pageCtx) {
        ctxStr = `Page: ${pageCtx.pageName}\n`;
        if (pageCtx.selectedBlockUUID) {
          ctxStr += `Current/Focused Block UUID: ${pageCtx.selectedBlockUUID}\n`;
          ctxStr += `Current/Focused Block Content: ${pageCtx.selectedBlockContent || ''}\n`;
          ctxStr += `(When the user says "this block", "current block", or "selected block", they mean the block above. Its sub-blocks are the blocks indented directly beneath it in the tree below.)\n`;
        }
        ctxStr += `Block tree (indentation = sub-blocks/children of the parent above):\n${pageCtx.formattedTree || '(empty page)'}`;
      }
      const plan = await loop.generatePlan(goal, ctxStr);
      setAgentPlan(plan);
      agentPlanRef.current = plan;
      setLoading(false);
      if (settings.agentAutonomy === 'autopilot') {
        setAgentRunning(true);
        loop.run(plan);
      }
      return;
    }

    // Check for agent handoff
    const handoff = getPendingAgentHandoff();
    if (handoff) {
      clearPendingAgentHandoff();
      setMessages(prev => [...prev, {
        id: `handoff_${Date.now()}`,
        content: `🔀 Handed off to **${handoff.targetAgentName}**${handoff.context ? ': ' + handoff.context : ''}`,
        sender: 'assistant',
        timestamp: chatTimestamp(),
      }]);
      setLoading(false);
      return;
    }


    if (aiEditMode && typeof resp === 'object' && resp !== null && 'text' in resp) {
      const editResp = resp;
      const assistantMsgId = Date.now() + '_assistant';
      const tokenUsage = getQueryTokenUsage();

      const commands = editResp.commands.filter((c: any) =>
        !(c.content && /^!\[.*?\]\(\s*\)$/.test(c.content.trim()))
      );

      const filteredCount = editResp.commands.length - commands.length;
      const displayText = (filteredCount > 0 && editResp.text.trim().length < 5)
        ? 'Image received. Use the copy-paste instructions below to insert it into your page.'
        : editResp.text;

      setMessages(prev => [...prev, {
        id: assistantMsgId,
        content: displayText,
        sender: 'assistant',
        model: settings?.selectedModel,
        timestamp: chatTimestamp(),
        promptTokens: tokenUsage.promptTokens || undefined,
        completionTokens: tokenUsage.completionTokens || undefined,
      }]);

      if (commands.length > 0) {
        const result = await executeAll(commands);

        const failures = await verifyAndCorrect(result);
        if (failures.length > 0) {
          result.verificationFailures = failures;
          const lines = failures.map((f: any) => {
            const action = f.command.action;
            const status = f.corrected ? '✓ corrected' : '✗ still failing';
            return `• ${action}: ${f.reason} [${status}]`;
          });
          setMessages(prev => [...prev, {
            id: Date.now() + '_verify',
            content: `⚠️ Verification found ${failures.length} issue(s):\n${lines.join('\n')}`,
            sender: 'assistant',
            timestamp: chatTimestamp(),
          }]);
        }
        setEditResults(prev => new Map(prev).set(assistantMsgId, result));
      }

      if (attachedImages.length > 0) {
        setMessages(prev => [...prev, {
          id: Date.now() + '_imgpaste',
          content: `📷 To insert the image into your page:\n1. Click **"📋 Copy Image"** below\n2. Click the target block in Logseq\n3. Press **Ctrl+V**\n\n` + attachedImages.map(img => `![attached image](${img.content})`).join('\n\n'),
          sender: 'assistant',
          timestamp: chatTimestamp(),
        }]);
      }
    } else {
      const responseText = typeof resp === 'string' ? resp : (resp as any).text;
      const tokenUsage = getQueryTokenUsage();
      if (!isStreamingStarted) {
        const assistantMsgId = Date.now() + '_assistant';
        setMessages(prev => [...prev, {
          id: assistantMsgId,
          content: responseText,
          sender: 'assistant',
          model: settings?.selectedModel,
          timestamp: chatTimestamp(),
          completedTimestamp: chatTimestamp(),
          promptTokens: tokenUsage.promptTokens || undefined,
          completionTokens: tokenUsage.completionTokens || undefined,
        }]);
      }
      if (isStreamingStarted) {
        setMessages(prev => prev.map(m =>
          m.id === streamingMsgId ? { ...m, completedTimestamp: chatTimestamp(), promptTokens: tokenUsage.promptTokens || undefined, completionTokens: tokenUsage.completionTokens || undefined } : m
        ));
      }
    }

    // Check if a memory was saved during this query
    if (getLastMemorySaved()) {
      setMemoryCount(prev => prev + 1);
      const memMsgId = `memory_saved_${Date.now()}`;
      setMessages(prev => [...prev, { id: memMsgId, content: '💾 Remembered', sender: 'assistant', timestamp: chatTimestamp() }]);
      setTimeout(() => setMessages(prev => prev.filter(m => m.id !== memMsgId)), 3000);
    }
  } catch (err: any) {
    abortControllerRef.current = null;
    if (err.name === 'AbortError') {
      return;
    }
    console.error('Error in handleQuery:', err);
    setError(err.message);
  } finally {
    setLoading(false);
    setThinkingText(null);
  }
}
