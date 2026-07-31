import React, { KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { ChatMessage } from 'components/ChatMessageList';
import { MemoryStore } from '../memory/MemoryStore';
import { setMemoryStore, getLastMemorySaved, setOnThoughtCallback } from '../manager';
import { summarizeSession } from '../memory/sessionSummarizer';
import { writeMemoryPage } from '../memory/logseqMemoryWriter';
import { AgentLoop } from '../agent/AgentLoop';
import { pendingAgentGoal, clearPendingAgentGoal } from '../manager';
import type { AgentProgressEvent } from '../agent/types';
import { clearConversationHistory, addToConversationHistory, handleQuery } from 'manager';
import { isHelpCommand, answerHelpQuestion } from '../helpSystem';
import { isToolsCommand, listBuiltInTools } from '../toolsCommand';
import { isRawCommand, extractRawPrompt, sendRawPrompt } from '../rawCommand';
import { executeAll, verifyAndCorrect } from '../blockExecutor';
import { getActivePageContext } from '../blockTreeFormatter';
import { useMemoryMonitor } from './useMemoryMonitor';
import type { MemoryStatus } from './useMemoryMonitor';
import type { StorageProvider } from '../storage/StorageProvider';
import type { ExecutionResult } from '../types/editTypes';
import type { AgentController } from './useAgentController';

interface Settings {
  selectedModel?: string;
  chatProvider?: string;
  chatEndpoint?: string;
  LiteLLMLink?: string;
  apiKey?: string;
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

interface UseChatSessionParams {
  settings: Settings;
  storageProvider: StorageProvider;
  aiEditMode: boolean;
  setAiEditMode: (val: boolean | ((prev: boolean) => boolean)) => void;
  agentController: AgentController;
}

/** Format current time as ISO-like timestamp for chat message headers. */
function chatTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}


export function useChatSession({ settings, storageProvider, aiEditMode, setAiEditMode, agentController }: UseChatSessionParams) {
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
    verboseMode,
  } = agentController;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSubmittedMessage, setLastSubmittedMessage] = useState<string>('');
  const [inputHistory, setInputHistory] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem('logseq-mixer-input-history');
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  });
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [savedDraft, setSavedDraft] = useState('');
  const [imageDataUrls, setImageDataUrls] = useState<{ name: string; content: string }[]>([]);
  const [attachedFiles, setAttachedFiles] = useState<{ name: string; content: string }[]>([]);
  const [editResults, setEditResults] = useState<Map<string | number, ExecutionResult>>(new Map());
  const [thinkingText, setThinkingText] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [memoryCount, setMemoryCount] = useState(0);
  const [memoryStoreInstance, setMemoryStoreInstance] = useState<MemoryStore | null>(null);

  // Persist input history to localStorage (cap at 100 entries)
  useEffect(() => {
    try {
      const capped = inputHistory.slice(-100);
      localStorage.setItem('logseq-mixer-input-history', JSON.stringify(capped));
    } catch { /* ignore quota errors */ }
  }, [inputHistory]);

  // Wire up thought callback for live thinking display
  useEffect(() => {
    setOnThoughtCallback((thought) => setThinkingText(thought));
    return () => setOnThoughtCallback(null);
  }, []);

  // Initialize MemoryStore from SQLite db
  useEffect(() => {
    const provider = storageProvider as any;
    if (provider?.db) {
      const store = new MemoryStore(provider.db);
      setMemoryStoreInstance(store);
      setMemoryStore(store);
      setMemoryCount(store.getMemoryCount());
    }
    // Re-initialize MemoryStore when graph changes
    const unlisten = logseq.App.onCurrentGraphChanged(async () => {
      // Wait for storage provider to reinitialize
      await new Promise(resolve => setTimeout(resolve, 1000));
      const p = storageProvider as any;
      if (p?.db) {
        const newStore = new MemoryStore(p.db);
        setMemoryStoreInstance(newStore);
        setMemoryStore(newStore);
        setMemoryCount(newStore.getMemoryCount());
      }
      // Reset UI state for the new graph
      setMessages([]);
      setAgentPlan(null);
      setAgentRunning(false);
      clearConversationHistory();
    });
    return () => { unlisten(); };
  }, [storageProvider]);

  // Memory monitor
  const MAX_MESSAGES = 100;
  const TRIM_TO = 40;

  const handleTrimMessages = useCallback(() => {
    setMessages(prev => {
      if (prev.length <= TRIM_TO) return prev;
      const trimmed = prev.slice(-TRIM_TO);
      console.info(`[MemoryMonitor] Trimmed messages: ${prev.length} → ${trimmed.length}`);
      return trimmed;
    });
  }, []);

  const handlePressureChange = useCallback((pressure: MemoryStatus['pressure'], status: MemoryStatus) => {
    if (pressure === 'critical') {
      console.warn(`[MemoryMonitor] CRITICAL memory pressure! Heap: ${(status.heapUsed / 1024 / 1024).toFixed(1)}MB, DOM: ${status.domNodeCount}, Messages: ${status.messageCount}`);
      handleTrimMessages();
    } else if (pressure === 'high') {
      console.warn(`[MemoryMonitor] High memory pressure. Messages: ${status.messageCount}, DOM: ${status.domNodeCount}`);
    }
  }, [handleTrimMessages]);

  const memoryStatus = useMemoryMonitor({
    messageCount: messages.length,
    onPressureChange: handlePressureChange,
    interval: 5000,
  });

  // Enforce message cap
  useEffect(() => {
    if (messages.length > MAX_MESSAGES) {
      console.info(`[MemoryMonitor] Message cap exceeded (${messages.length}/${MAX_MESSAGES}), auto-trimming.`);
      setMessages(prev => prev.slice(-TRIM_TO));
    }
  }, [messages.length]);


  const handleFile = (file: File) => {
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => setImageDataUrls(prev => [...prev, { name: file.name, content: reader.result as string }]);
      reader.readAsDataURL(file);
    } else {
      const reader = new FileReader();
      reader.onload = () => {
        setAttachedFiles(prev => [...prev, { name: file.name, content: reader.result as string }]);
      };
      reader.readAsText(file);
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) handleFile(file);
        break;
      }
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputMessage(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  };


  const handleSubmit = async (textareaRef: React.RefObject<HTMLTextAreaElement>) => {
    const messageToSend = inputMessage.trim() || lastSubmittedMessage;
    if (!messageToSend) return;

    setInputHistory(prev => [...prev, messageToSend]);
    setHistoryIndex(-1);
    setSavedDraft('');
    setLastSubmittedMessage(messageToSend);

    const isRetry = !inputMessage.trim();
    if (!isRetry) {
      const userMessage: ChatMessage = {
        id: Date.now() + '_user',
        content: messageToSend,
        sender: 'user',
        timestamp: chatTimestamp(),
        image: imageDataUrls.length > 0 ? imageDataUrls : undefined,
        file: attachedFiles.length > 0 ? attachedFiles : undefined,
      };
      setMessages(prev => [...prev, userMessage]);
    }
    setLoading(true);
    setError(null);
    setInputMessage('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    // Handle /help commands directly without going through RAG
    if (isHelpCommand(messageToSend)) {
      try {
        const helpResponse = await answerHelpQuestion(messageToSend, settings);
        setMessages(prev => [...prev, { id: Date.now() + '_help', content: helpResponse, sender: 'assistant', model: settings?.selectedModel, timestamp: chatTimestamp() }]);
      } catch (err: any) {
        setError(err.message || 'Help system error');
      } finally {
        setLoading(false);
        setThinkingText(null);
      }
      return;
    }

    // Handle /tools command
    if (isToolsCommand(messageToSend)) {
      const toolsResponse = listBuiltInTools();
      setMessages(prev => [...prev, { id: Date.now() + '_tools', content: toolsResponse, sender: 'assistant', timestamp: chatTimestamp() }]);
      setLoading(false);
      setThinkingText(null);
      return;
    }

    // Handle /raw command
    if (isRawCommand(messageToSend)) {
      const rawPrompt = extractRawPrompt(messageToSend);
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
      return;
    }


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
      setImageDataUrls([]);
      setAttachedFiles([]);
      const fileAppendix = fileContexts.length > 0
        ? '\n\n---\n' + fileContexts.map(f => `Attached file: ${f.name}\n\`\`\`\n${f.content}\n\`\`\``).join('\n\n')
        : '';
      const queryWithFile = messageToSend + fileAppendix;
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
          onReplanProposed: (reason: string, newSteps: import('../agent/types').AgentStep[]) => new Promise<boolean>(resolve => {
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


      if (aiEditMode && typeof resp === 'object' && resp !== null && 'text' in resp) {
        const editResp = resp;
        const assistantMsgId = Date.now() + '_assistant';

        const commands = editResp.commands.filter(c =>
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
        }]);

        if (commands.length > 0) {
          const result = await executeAll(commands);

          const failures = await verifyAndCorrect(result);
          if (failures.length > 0) {
            result.verificationFailures = failures;
            const lines = failures.map(f => {
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
        const responseText = typeof resp === 'string' ? resp : resp.text;
        if (!isStreamingStarted) {
          const assistantMsgId = Date.now() + '_assistant';
          setMessages(prev => [...prev, {
            id: assistantMsgId,
            content: responseText,
            sender: 'assistant',
            model: settings?.selectedModel,
            timestamp: chatTimestamp(),
            completedTimestamp: chatTimestamp(),
          }]);
        }
        if (isStreamingStarted) {
          setMessages(prev => prev.map(m =>
            m.id === streamingMsgId ? { ...m, completedTimestamp: chatTimestamp() } : m
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
  };


  const handleCancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setLoading(false);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>, handleSubmitFn: () => void) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmitFn();
      return;
    }
    if (e.key === 'ArrowUp' && inputHistory.length > 0) {
      const ta = e.currentTarget;
      if (ta.selectionStart === 0 && ta.selectionEnd === 0) {
        e.preventDefault();
        if (historyIndex === -1) {
          setSavedDraft(inputMessage);
          const idx = inputHistory.length - 1;
          setHistoryIndex(idx);
          setInputMessage(inputHistory[idx]);
        } else if (historyIndex > 0) {
          const idx = historyIndex - 1;
          setHistoryIndex(idx);
          setInputMessage(inputHistory[idx]);
        }
      }
    }
    if (e.key === 'ArrowDown' && historyIndex >= 0) {
      const ta = e.currentTarget;
      if (ta.selectionStart === ta.value.length) {
        e.preventDefault();
        if (historyIndex < inputHistory.length - 1) {
          const idx = historyIndex + 1;
          setHistoryIndex(idx);
          setInputMessage(inputHistory[idx]);
        } else {
          setHistoryIndex(-1);
          setInputMessage(savedDraft);
        }
      }
    }
  };

  const handleNewSession = () => {
    const capturedMessages = messages.map(m => ({ role: m.sender === 'user' ? 'user' as const : 'assistant' as const, content: m.content }));
    setMessages([]);
    setInputMessage('');
    setError(null);
    setAiEditMode(false);
    setEditResults(new Map());
    setAgentPlan(null);
    setAgentRunning(false);
    setAgentTokensUsed(0);
    setEscalationQuestion(null);
    setReplanReason(null);
    setReplanSteps([]);
    agentAbortRef.current?.abort();
    agentAbortRef.current = null;
    agentLoopRef.current = null;
    clearConversationHistory();

    if (settings?.memoryEnabled && settings?.autoSummarize && capturedMessages.length >= 4 && memoryStoreInstance) {
      setIsSummarizing(true);
      summarizeSession(capturedMessages, settings).then(summary => {
        if (summary && memoryStoreInstance) {
          memoryStoreInstance.addMemoryIfUnique('session_summary', summary, 'auto');
          writeMemoryPage(summary, 'session_summary');
          setMemoryCount(memoryStoreInstance.getMemoryCount());
        }
      }).finally(() => setIsSummarizing(false));
    }
  };

  return {
    messages,
    setMessages,
    inputMessage,
    setInputMessage,
    loading,
    setLoading,
    error,
    setError,
    editResults,
    setEditResults,
    thinkingText,
    imageDataUrls,
    setImageDataUrls,
    attachedFiles,
    setAttachedFiles,
    inputHistory,
    setInputHistory,
    historyIndex,
    setHistoryIndex,
    isSummarizing,
    memoryCount,
    setMemoryCount,
    memoryStoreInstance,
    setMemoryStoreInstance,
    memoryStatus,
    handleTrimMessages,
    handleFile,
    handlePaste,
    handleInputChange,
    handleSubmit,
    handleCancel,
    handleKeyDown,
    handleNewSession,
  };
}
