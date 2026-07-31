import React, { KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { ChatMessage } from 'components/ChatMessageList';
import { MemoryStore } from '../memory/MemoryStore';
import { setMemoryStore, setOnThoughtCallback } from '../manager';
import { summarizeSession } from '../memory/sessionSummarizer';
import { writeMemoryPage } from '../memory/logseqMemoryWriter';
import { clearConversationHistory } from 'manager';
import { isHelpCommand } from '../helpSystem';
import { isToolsCommand } from '../toolsCommand';
import { isRawCommand } from '../rawCommand';
import { useMemoryMonitor } from './useMemoryMonitor';
import type { MemoryStatus } from './useMemoryMonitor';
import type { StorageProvider } from '../storage/StorageProvider';
import type { ExecutionResult } from '../types/editTypes';
import type { AgentController } from './useAgentController';
import { handleHelpCommand, handleToolsCommand, handleRawCommand, handleChatQuery } from './chatHandlers';

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

    // Dispatch to command-specific handlers
    if (isHelpCommand(messageToSend)) {
      try {
        await handleHelpCommand(messageToSend, settings, setMessages, setLoading, setThinkingText);
      } catch (err: any) {
        setError(err.message || 'Help system error');
        setLoading(false);
        setThinkingText(null);
      }
      return;
    }

    if (isToolsCommand(messageToSend)) {
      handleToolsCommand(setMessages, setLoading, setThinkingText);
      return;
    }

    if (isRawCommand(messageToSend)) {
      await handleRawCommand(messageToSend, settings, abortControllerRef, setMessages, setLoading, setThinkingText, setError);
      return;
    }

    // Main chat/edit/agent flow
    const currentImages = imageDataUrls;
    const currentFiles = attachedFiles;
    setImageDataUrls([]);
    setAttachedFiles([]);

    await handleChatQuery({
      message: messageToSend,
      settings,
      storageProvider,
      aiEditMode,
      imageDataUrls: currentImages,
      attachedFiles: currentFiles,
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
    });
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
