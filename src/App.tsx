import { AppUserConfigs } from '@logseq/libs/dist/LSPlugin';
import ChatMessageList, { ChatMessage } from 'components/ChatMessageList';
import MCPServerPanel from 'components/MCPServerPanel';
import MemoryPanel from './components/MemoryPanel';
import { MCPManager } from 'mcp/MCPManager';
import { MemoryStore } from './memory/MemoryStore';
import { setMemoryStore, getLastMemorySaved, setOnThoughtCallback } from './manager';
import { summarizeSession } from './memory/sessionSummarizer';
import { writeMemoryPage } from './memory/logseqMemoryWriter';
import { AgentLoop } from './agent/AgentLoop';
import AgentProgress from './components/AgentProgress';
import { pendingAgentGoal, clearPendingAgentGoal } from './manager';
import type { AgentPlan, AgentProgressEvent, AgentStep } from './agent/types';
import { useThemeMode } from 'hooks/useThemeMode';
import type { IndexingResult } from 'indexManager';
import { cancelAutoIndexDebounce, getIndexingProgress, isIndexingActive, requestPauseIndexing, setAutoEmbedEnabled as setAutoEmbedEnabledIM, setAutoIndexDebounceSeconds } from 'indexManager';
import { clearConversationHistory, addToConversationHistory, enableAutoIndexer, handleQuery, indexEntireLogSeq } from 'manager';
import { isHelpCommand, answerHelpQuestion } from './helpSystem';
import React, { KeyboardEvent, useEffect, useRef, useState } from 'react';
import { useRecoilState, useRecoilValue } from 'recoil';
import { executeAll, verifyAndCorrect } from './blockExecutor';
import { getActivePageContext } from './blockTreeFormatter';
import { getButtonState } from './buttonState';
import { AutoEmbedToggle } from './components/AutoEmbedToggle';
import { ChangeSummary } from './components/ChangeSummary';
import { AgentToggle } from './components/AgentToggle';
import { EditToggle } from './components/EditToggle';
import { VerboseToggle } from './components/VerboseToggle';
import { cancelCooldown, startCooldown } from './cooldownManager';
import { useAppVisible } from './hooks/useAppVisible';
import { useCtrlKey } from './hooks/useCtrlKey';
import { aiEditModeState, settingsState } from './state/settings';
import { darkTheme, keyframes, styled } from './stitches.config';
import type { StorageProvider } from './storage/StorageProvider';
import type { ExecutionResult } from './types/editTypes';
import { fetchLiteLLMModels } from './LLMManager';

function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// --- Animations ---

const slideIn = keyframes({
  '0%': { transform: 'translateX(100%)' },
  '100%': { transform: 'translateX(0)' },
});

const fadeIn = keyframes({
  '0%': { opacity: 0, transform: 'translateY(-4px)' },
  '100%': { opacity: 1, transform: 'translateY(0)' },
});

const fadeOut = keyframes({
  '0%': { opacity: 1, transform: 'translateY(0)' },
  '100%': { opacity: 0, transform: 'translateY(-4px)' },
});

const pulse = keyframes({
  '0%, 100%': { opacity: 0.4 },
  '50%': { opacity: 1 },
});

// --- Styled Components ---

const Overlay = styled('div', {
  position: 'fixed',
  top: 0, right: 0, bottom: 0, left: 0,
  zIndex: 99,
  backgroundColor: 'rgba(0, 0, 0, 0.15)',
});

const ChatPanel = styled('main', {
  position: 'fixed',
  top: 0, right: 0, bottom: 0,
  width: '520px',
  maxWidth: '85%',
  backgroundColor: '$elevation0',
  boxShadow: '-4px 0 24px rgba(0, 0, 0, 0.12)',
  display: 'flex',
  flexDirection: 'column',
  zIndex: 100,
  animation: `${slideIn} 0.25s ease-out`,
  borderLeft: '1px solid $slate6',
});

const Header = styled('div', {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '12px 16px',
  borderBottom: '1px solid $slate6',
  backgroundColor: '$elevation0',
});

const HeaderLeft = styled('div', {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
});

const LogoIcon = styled('img', { width: '18px', height: '18px', borderRadius: '4px' });

const Title = styled('h2', {
  margin: 0,
  fontSize: '15px',
  fontWeight: 600,
  color: '$highContrast',
});

const CloseButton = styled('button', {
  background: 'transparent',
  border: 'none',
  width: '28px',
  height: '28px',
  borderRadius: '6px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  color: '$slate9',
  fontSize: '14px',
  transition: 'all 0.15s',
  '&:hover': { backgroundColor: '$slate3', color: '$highContrast' },
});

const HeaderRight = styled('div', {
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
});

const HeaderButton = styled('button', {
  background: 'transparent',
  border: '1px solid $slate6',
  borderRadius: '6px',
  padding: '4px 8px',
  cursor: 'pointer',
  color: '$slate10',
  fontSize: '12px',
  fontWeight: 500,
  transition: 'all 0.15s',
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
  '&:hover': { backgroundColor: '$slate3', borderColor: '$slate8', color: '$highContrast' },
});

const MODEL_CHOICES = [
  'gpt-3.5-turbo',
  'gpt-4',
  'gpt-4o',
  'claude-2',
  'claude-3-opus',
  'gemini-pro',
  'codestral/codestral-latest',
  'deepseek-chat',
];

const ModelSelect = styled('select', {
  background: 'transparent',
  border: '1px solid $slate6',
  borderRadius: '6px',
  padding: '4px 24px 4px 8px',
  cursor: 'pointer',
  color: '$slate10',
  fontSize: '12px',
  fontWeight: 500,
  transition: 'all 0.15s',
  outline: 'none',
  fontFamily: '$sans',
  appearance: 'none',
  backgroundImage: `url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 6px center',
  backgroundSize: '12px',
  '&:hover': { backgroundColor: '$slate3', borderColor: '$slate8', color: '$highContrast' },
  '&:focus': { borderColor: '$blue8' },
  '& option': {
    backgroundColor: '$elevation0',
    color: '$highContrast',
  },
});

const DbPanel = styled('div', {
  position: 'absolute',
  top: '53px',
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: '$elevation0',
  zIndex: 10,
  display: 'flex',
  flexDirection: 'column',
  padding: '24px 20px',
  animation: `${fadeIn} 0.2s ease-out`,
});

const DbPanelHeader = styled('div', {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: '20px',
  borderBottom: '1px solid $slate6',
  paddingBottom: '10px',
});

const DbPanelTitle = styled('h3', {
  margin: 0,
  fontSize: '16px',
  fontWeight: 600,
  color: '$highContrast',
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
});

const DbStatsList = styled('div', {
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
  flex: 1,
  overflowY: 'auto',
});

const DbStatRow = styled('div', {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '10px 12px',
  backgroundColor: '$slate3',
  borderRadius: '8px',
  border: '1px solid $slate5',
});

const DbStatLabel = styled('span', {
  fontSize: '13px',
  fontWeight: 500,
  color: '$slate11',
});

const DbStatValue = styled('span', {
  fontSize: '13px',
  fontWeight: 600,
  color: '$highContrast',
});

const DbPanelActions = styled('div', {
  display: 'flex',
  gap: '10px',
  marginTop: '20px',
});

const DbPanelButton = styled('button', {
  flex: 1,
  padding: '10px 16px',
  borderRadius: '8px',
  fontSize: '13px',
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'all 0.15s',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '6px',
  fontFamily: '$sans',

  variants: {
    variant: {
      primary: {
        backgroundColor: '$blue9',
        color: 'white',
        border: 'none',
        '&:hover': { backgroundColor: '$blue10' },
        '&:active': { transform: 'scale(0.98)' },
      },
      secondary: {
        backgroundColor: 'transparent',
        border: '1px solid $slate6',
        color: '$slate11',
        '&:hover': { backgroundColor: '$slate3', color: '$highContrast' },
        '&:active': { transform: 'scale(0.98)' },
      },
    },
  },
  defaultVariants: {
    variant: 'secondary',
  },
});

const MessagesContainer = styled('div', {
  flex: 1,
  overflowY: 'auto',
  padding: '16px',
  backgroundColor: '$elevation0',
  '&::-webkit-scrollbar': { width: '6px' },
  '&::-webkit-scrollbar-track': { background: 'transparent' },
  '&::-webkit-scrollbar-thumb': { background: '$slate6', borderRadius: '3px' },
  '& a.ctrl-link': {
    color: 'inherit',
    textDecoration: 'none',
    cursor: 'default',
  },
  '&.ctrl-held a.ctrl-link:hover': {
    textDecoration: 'underline',
    cursor: 'pointer',
  },
});

const ErrorBanner = styled('div', {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  margin: '0 16px',
  padding: '8px 12px',
  backgroundColor: '$red3',
  border: '1px solid $red6',
  borderRadius: '8px',
  color: '$red11',
  fontSize: '13px',
});

const RetryButton = styled('button', {
  background: 'none',
  border: 'none',
  color: '$red11',
  textDecoration: 'underline',
  cursor: 'pointer',
  fontSize: '13px',
  fontWeight: 500,
  padding: 0,
  '&:hover': { color: '$red12' },
});

const InputArea = styled('div', {
  padding: '12px 16px 16px',
  borderTop: '1px solid $slate6',
  backgroundColor: '$elevation0',
});

const InputWrapper = styled('div', {
  display: 'flex',
  alignItems: 'flex-end',
  gap: '8px',
  border: '1px solid $slate7',
  borderRadius: '10px',
  padding: '8px 8px 8px 12px',
  backgroundColor: '$elevation1',
  transition: 'border-color 0.15s, box-shadow 0.15s',
  '&:focus-within': { borderColor: '$blue8', boxShadow: '0 0 0 2px $colors$blue4' },
});

const TextArea = styled('textarea', {
  flex: 1,
  minHeight: '80px',
  maxHeight: '160px',
  resize: 'none',
  border: 'none',
  background: 'transparent',
  padding: 0,
  fontSize: '14px',
  fontFamily: 'inherit',
  lineHeight: 1.5,
  outline: 'none',
  color: '$highContrast',
  overflowY: 'auto',
  '&::placeholder': { color: '$slate8' },
  '&:disabled': { opacity: 0.5 },
  '&::-webkit-scrollbar': { width: '4px' },
  '&::-webkit-scrollbar-thumb': { background: '$slate6', borderRadius: '2px' },
});

const SendButton = styled('button', {
  width: '32px',
  height: '32px',
  borderRadius: '8px',
  border: 'none',
  backgroundColor: '$blue9',
  color: 'white',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  transition: 'background-color 0.15s, transform 0.1s',
  '&:hover:not(:disabled)': { backgroundColor: '$blue10' },
  '&:active:not(:disabled)': { transform: 'scale(0.95)' },
  '&:disabled': { opacity: 0.4, cursor: 'default' },
  svg: { width: '16px', height: '16px', fill: 'currentColor' },
});

const ToolbarRow = styled('div', {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '6px',
  marginTop: '8px',
});

const ImageButton = styled('button', {
  width: '28px',
  height: '28px',
  borderRadius: '6px',
  border: 'none',
  backgroundColor: 'transparent',
  color: '$gray11',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  '&:hover:not(:disabled)': { backgroundColor: '$gray4' },
  '&:disabled': { opacity: 0.4, cursor: 'default' },
});

const StatusText = styled('span', {
  fontSize: '11px',
  color: '$slate9',
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
});

const ToolbarButton = styled('button', {
  padding: '5px 10px',
  borderRadius: '6px',
  border: '1px solid $slate6',
  backgroundColor: '$elevation1',
  color: '$slate11',
  fontSize: '12px',
  fontWeight: 500,
  cursor: 'pointer',
  transition: 'all 0.15s',
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
  '&:hover': { backgroundColor: '$elevation2', borderColor: '$slate8', color: '$highContrast' },
  variants: {
    variant: {
      index: {
        backgroundColor: '$green3',
        borderColor: '$green7',
        color: '$green11',
        '&:hover': { backgroundColor: '$green4', borderColor: '$green8', color: '$green12' },
      },
      pause: {
        backgroundColor: '$red3',
        borderColor: '$red7',
        color: '$red11',
        '&:hover': { backgroundColor: '$red4', borderColor: '$red8', color: '$red12' },
      },
    },
  },
});

const TypingIndicator = styled('div', {
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
  padding: '12px 16px',
  color: '$slate9',
  fontSize: '13px',
});

const Dot = styled('span', {
  width: '6px',
  height: '6px',
  borderRadius: '50%',
  backgroundColor: '$slate8',
  animation: `${pulse} 1.2s ease-in-out infinite`,
  variants: {
    delay: {
      0: { animationDelay: '0s' },
      1: { animationDelay: '0.2s' },
      2: { animationDelay: '0.4s' },
    },
  },
});

const StatusIndicator = styled('span', {
  fontSize: '11px',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  padding: '2px 8px',
  borderRadius: '6px',
  fontWeight: 500,

  '@motionSafe': {
    animation: `${fadeIn} 0.2s ease-out`,
  },

  variants: {
    variant: {
      success: {
        backgroundColor: '$green3',
        color: '$green11',
      },
      paused: {
        backgroundColor: '$amber3',
        color: '$amber11',
      },
      progress: {
        backgroundColor: 'transparent',
        color: '$slate9',
      },
    },
    dismissing: {
      true: {
        '@motionSafe': {
          animation: `${fadeOut} 0.2s ease-in forwards`,
        },
      },
    },
  },
});

// --- Component ---

type Props = {
  themeMode: AppUserConfigs['preferredThemeMode'];
  storageProvider: StorageProvider;
};

export function App({ themeMode: initialThemeMode, storageProvider }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isVisible = useAppVisible();
  const themeMode = useThemeMode(initialThemeMode);
  const ctrlHeld = useCtrlKey();
  const settings = useRecoilValue(settingsState);
  const [aiEditMode, setAiEditMode] = useRecoilState(aiEditModeState);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSubmittedMessage, setLastSubmittedMessage] = useState<string>('');
  const [isIndexing, setIsIndexing] = useState(isIndexingActive());
  const [editResults, setEditResults] = useState<Map<string | number, ExecutionResult>>(new Map());

  const [inputHistory, setInputHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [savedDraft, setSavedDraft] = useState('');
  const [imageDataUrls, setImageDataUrls] = useState<{ name: string; content: string }[]>([]);
  const [attachedFiles, setAttachedFiles] = useState<{ name: string; content: string }[]>([]);
  const [activePageName, setActivePageName] = useState<string | null>(null);
  const [activeBlockContent, setActiveBlockContent] = useState<string | null>(null);
  const imageFileRef = useRef<HTMLInputElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const agentAbortRef = useRef<AbortController | null>(null);
  const [docCount, setDocCount] = useState<number | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [dbSize, setDbSize] = useState<number | null>(null);
  const [indexingStatus, setIndexingStatus] = useState<IndexingResult | null>(null);
  const [isDismissing, setIsDismissing] = useState(false);
  const [progressCount, setProgressCount] = useState(getIndexingProgress);
  const [autoEmbedEnabled, setAutoEmbedEnabled] = useState(() => (logseq.settings?.autoEmbedEnabled as boolean) ?? true);
  const [agentModeOn, setAgentModeOn] = useState(() => (logseq.settings?.agentMode as string) !== 'off');
  const [verboseMode, setVerboseMode] = useState(() => (logseq.settings?.agentVerboseMode as boolean) ?? true);
  const [cooldownActive, setCooldownActive] = useState(false);
  const [showDbPanel, setShowDbPanel] = useState(false);
  const [showMcpPanel, setShowMcpPanel] = useState(false);
  const [showMemoryPanel, setShowMemoryPanel] = useState(false);
  const [confirmClearDb, setConfirmClearDb] = useState(false);
  const [memoryCount, setMemoryCount] = useState(0);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [memoryStoreInstance, setMemoryStoreInstance] = useState<MemoryStore | null>(null);
  const [thinkingText, setThinkingText] = useState<string | null>(null);

  // Agent state
  const [agentPlan, setAgentPlan] = useState<AgentPlan | null>(null);
  const agentPlanRef = useRef<AgentPlan | null>(null);
  const [agentRunning, setAgentRunning] = useState(false);
  const [agentTokensUsed, setAgentTokensUsed] = useState(0);
  const [escalationQuestion, setEscalationQuestion] = useState<string | null>(null);
  const agentLoopRef = useRef<AgentLoop | null>(null);
  const escalationResolverRef = useRef<((answer: string) => void) | null>(null);
  const [replanReason, setReplanReason] = useState<string | null>(null);
  const [replanSteps, setReplanSteps] = useState<AgentStep[]>([]);
  const replanResolverRef = useRef<((approved: boolean) => void) | null>(null);

  // Cancel cooldown timer on unmount
  useEffect(() => {
    return () => { cancelCooldown(); };
  }, []);

  // Initialize and lifecycle manage MCPManager
  useEffect(() => {
    const manager = MCPManager.getInstance();
    manager.initialize();
    const onSettingsChanged = () => {
      manager.syncWithSettings();
    };
    window.logseq.onSettingsChanged(onSettingsChanged);
    return () => {
      manager.shutdown();
    };
  }, []);

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

  // Track active page name
  useEffect(() => {
    const updatePage = async () => {
      try {
        let page = await logseq.Editor.getCurrentPage();
        const block = await logseq.Editor.getCurrentBlock();
        if (!page) {
          if (block?.page) page = await logseq.Editor.getPage(block.page.id);
        }
        setActivePageName(page?.name as string ?? null);
        setActiveBlockContent(block?.content?.trim()?.slice(0, 50) || null);
      } catch {
        setActivePageName(null);
        setActiveBlockContent(null);
      }
    };
    updatePage();
    const id = setInterval(updatePage, 3000);
    return () => clearInterval(id);
  }, []);

  // Poll document, page count, and database size every 10 seconds
  useEffect(() => {
    const fetchCount = async () => {
      if (storageProvider.getDocumentCount) {
        try {
          const count = await storageProvider.getDocumentCount();
          setDocCount(count);
        } catch { /* ignore */ }
      }
      if (storageProvider.getPageCount) {
        try {
          const count = await storageProvider.getPageCount();
          setPageCount(count);
        } catch { /* ignore */ }
      }
      if (storageProvider.getDatabaseSize) {
        try {
          const size = await storageProvider.getDatabaseSize();
          setDbSize(size);
        } catch { /* ignore */ }
      }
    };
    fetchCount();
    const interval = setInterval(fetchCount, 10000);
    return () => clearInterval(interval);
  }, [storageProvider]);

  useEffect(() => {
    if (settings) {
      enableAutoIndexer(settings, storageProvider);
      // Sync configurable debounce delay from settings
      const debounce = settings.autoIndexDebounceSeconds;
      if (typeof debounce === 'number' && debounce > 0) {
        setAutoIndexDebounceSeconds(debounce);
      }
    }
  }, [settings]);

  // Auto-dismiss success status after 4 seconds
  useEffect(() => {
    if (indexingStatus?.outcome !== 'completed') return;
    const timer = setTimeout(() => {
      setIsDismissing(true);
      // Remove from DOM after animation completes
      setTimeout(() => { setIndexingStatus(null); setIsDismissing(false); }, 200);
    }, 4000);
    return () => clearTimeout(timer);
  }, [indexingStatus]);

  // Poll indexing progress every 500ms while indexing is active.
  // Also detects when auto-indexer finishes (isIndexingActive becomes false).
  useEffect(() => {
    if (!isIndexing) return;
    const interval = setInterval(() => {
      setProgressCount(getIndexingProgress());
      // Detect auto-indexer completion
      if (!manualIndexingRef.current && !isIndexingActive()) {
        setIsIndexing(false);
      }
    }, 500);
    return () => clearInterval(interval);
  }, [isIndexing]);

  // Detect auto-indexer activity: poll isIndexingActive() to sync the
  // React isIndexing state with the module-level indexingInProgress flag.
  // Polls every 1s when the panel is visible and not during manual indexing.
  const manualIndexingRef = useRef(false);
  useEffect(() => {
    if (!isVisible) return;
    const interval = setInterval(() => {
      if (manualIndexingRef.current) return;
      const active = isIndexingActive();
      setIsIndexing(prev => {
        if (active && !prev) return true;
        return prev;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [isVisible]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading, agentPlan, agentTokensUsed]);

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

  const handleSubmit = async () => {
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
        setMessages(prev => [...prev, { id: Date.now() + '_help', content: helpResponse, sender: 'assistant' }]);
      } catch (err: any) {
        setError(err.message || 'Help system error');
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
      const resp = await handleQuery(queryWithFile, settings, storageProvider, controller.signal, effectiveEditMode, attachedImages[0]?.content ?? undefined);
      abortControllerRef.current = null;

      // Handle agent goal detection
      if (resp === '__AGENT_GOAL_DETECTED__' && pendingAgentGoal) {
        const goal = pendingAgentGoal;
        clearPendingAgentGoal();
        setLoading(true);
        const agentController = new AbortController();
        agentAbortRef.current = agentController;
        const loop = new AgentLoop({
          settings,
          signal: agentController.signal,
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
            if (event.type === 'complete' || event.type === 'aborted') {
              setAgentRunning(false);
              setLoading(false);
              // Convert completed agent plan to a chat message so it scrolls with history
              const currentPlan = agentPlanRef.current;
              if (currentPlan) {
                const stepsSummary = currentPlan.steps.map(s => {
                  const icon = s.status === 'done' ? '✅' : s.status === 'failed' ? '❌' : s.status === 'skipped' ? '⏭️' : '⏳';
                  return `${icon} ${s.id}. ${s.description}`;
                }).join('  \n');
                // Include the last completed step's output as the final answer
                const doneSteps = currentPlan.steps.filter(s => s.status === 'done' && s.output);
                const lastOutput = doneSteps.length > 0 ? doneSteps[doneSteps.length - 1].output : '';
                const finalAnswer = lastOutput ? `\n\n---\n\n${lastOutput}` : '';
                const messageContent = `🤖 **Goal:** ${currentPlan.goal}\n\n${stepsSummary}\n\n${event.message}${finalAnswer}`;
                setMessages(prev => [...prev, {
                  id: `agent_${Date.now()}`,
                  content: messageContent,
                  sender: 'assistant',
                }]);
                // Add to conversation history so follow-up questions have context
                addToConversationHistory('user', `[Agent goal]: ${currentPlan.goal}`);
                addToConversationHistory('assistant', lastOutput || `Completed goal: ${currentPlan.goal}. ${event.message}`);
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
        const ctxStr = pageCtx ? `Page: ${pageCtx.pageName}\n${pageCtx.formattedTree?.slice(0, 500) || ''}` : '';
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

        // Filter out commands that only contain image placeholders
        const commands = editResp.commands.filter(c =>
          !(c.content && /^!\[.*?\]\(\s*\)$/.test(c.content.trim()))
        );

        // If image commands were filtered and text is minimal, use a better message
        const filteredCount = editResp.commands.length - commands.length;
        const displayText = (filteredCount > 0 && editResp.text.trim().length < 5)
          ? 'Image received. Use the copy-paste instructions below to insert it into your page.'
          : editResp.text;

        setMessages(prev => [...prev, {
          id: assistantMsgId,
          content: displayText,
          sender: 'assistant',
        }]);

        if (commands.length > 0) {
          const result = await executeAll(commands);

          // Verify edits actually took effect and retry failures
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
            }]);
          }
          setEditResults(prev => new Map(prev).set(assistantMsgId, result));
        }

        // If user attached an image, show copy-paste instructions
        if (attachedImages.length > 0) {
          setMessages(prev => [...prev, {
            id: Date.now() + '_imgpaste',
            content: `📷 To insert the image into your page:\n1. Click **"📋 Copy Image"** below\n2. Click the target block in Logseq\n3. Press **Ctrl+V**\n\n` + attachedImages.map(img => `![attached image](${img.content})`).join('\n\n'),
            sender: 'assistant',
          }]);
        }
      } else {
        const responseText = typeof resp === 'string' ? resp : resp.text;
        const assistantMsgId = Date.now() + '_assistant';
        setMessages(prev => [...prev, {
          id: assistantMsgId,
          content: responseText,
          sender: 'assistant',
        }]);
      }

      // Check if a memory was saved during this query
      if (getLastMemorySaved()) {
        setMemoryCount(prev => prev + 1);
        const memMsgId = `memory_saved_${Date.now()}`;
        setMessages(prev => [...prev, { id: memMsgId, content: '💾 Remembered', sender: 'assistant' }]);
        setTimeout(() => setMessages(prev => prev.filter(m => m.id !== memMsgId)), 3000);
      }
    } catch (err: any) {
      abortControllerRef.current = null;
      if (err.name === 'AbortError') {
        // User cancelled — don't show error
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

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
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

  const handleIndexDB = async () => {
    if (isIndexing) {
      requestPauseIndexing();
      cancelAutoIndexDebounce();
      startCooldown(() => setCooldownActive(false));
      setCooldownActive(true);
      return;
    }
    if (cooldownActive) return;
    manualIndexingRef.current = true;
    setIsIndexing(true);
    setError(null);
    setIndexingStatus(null);
    setIsDismissing(false);

    try {
      const result = await indexEntireLogSeq(settings, storageProvider);
      if (result.outcome === 'error') {
        setError(result.errorMessage || 'Indexing failed.');
      } else {
        setIndexingStatus(result);
      }
    } catch (err: any) {
      setError(err.message || 'Indexing failed.');
    } finally {
      setIsIndexing(false);
      manualIndexingRef.current = false;
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

  const handleAutoEmbedToggle = () => {
    const newValue = !autoEmbedEnabled;
    setAutoEmbedEnabled(newValue);
    setAutoEmbedEnabledIM(newValue);
    logseq.updateSettings({ autoEmbedEnabled: newValue });
    // When disabling auto-embed, also stop any in-progress auto-indexing
    // and cancel pending debounce timers so the user gets immediate feedback
    if (!newValue && isIndexing && !manualIndexingRef.current) {
      requestPauseIndexing();
      cancelAutoIndexDebounce();
    }
  };

  const handleAgentModeToggle = () => {
    const newMode = agentModeOn ? 'off' : 'on';
    setAgentModeOn(!agentModeOn);
    logseq.updateSettings({ agentMode: newMode });
  };

  const handleVerboseToggle = () => {
    const newValue = !verboseMode;
    setVerboseMode(newValue);
    logseq.updateSettings({ agentVerboseMode: newValue });
  };

  const currentModel = settings?.selectedModel || 'gpt-3.5-turbo';
  const [fetchedModels, setFetchedModels] = useState<string[]>(MODEL_CHOICES);

  useEffect(() => {
    const loadModels = async () => {
      if (settings?.chatEndpoint || settings?.LiteLLMLink) {
        try {
          const models = await fetchLiteLLMModels(settings.chatEndpoint || settings.LiteLLMLink, settings.apiKey || '');
          if (models && models.length > 0) {
            setFetchedModels(models);
          }
        } catch (err) {
          console.warn('Failed to fetch models from LiteLLM, using default list:', err);
        }
      }
    };
    loadModels();
  }, [settings?.chatEndpoint, settings?.LiteLLMLink, settings?.apiKey]);

  const modelChoices = fetchedModels.includes(currentModel)
    ? fetchedModels
    : [currentModel, ...fetchedModels];

  const handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newModel = e.target.value;
    logseq.updateSettings({ selectedModel: newModel });
  };

  const handleImportFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const buffer = event.target?.result as ArrayBuffer;
      if (buffer) {
        try {
          if (storageProvider.importFromFile) {
            await storageProvider.importFromFile(buffer);
            
            // Reload page and document count statistics
            if (storageProvider.getDocumentCount) {
              const dCount = await storageProvider.getDocumentCount();
              setDocCount(dCount);
            }
            if (storageProvider.getPageCount) {
              const pCount = await storageProvider.getPageCount();
              setPageCount(pCount);
            }
            if (storageProvider.getDatabaseSize) {
              const size = await storageProvider.getDatabaseSize();
              setDbSize(size);
            }
            
            window.logseq.UI.showMsg('Database imported successfully!', 'success');
          } else {
            window.logseq.UI.showMsg('Import not supported by the current storage backend.', 'error');
          }
        } catch (err: any) {
          console.error('Import failed:', err);
          window.logseq.UI.showMsg(`Import failed: ${err.message}`, 'error');
        }
      }
    };
    reader.onerror = () => {
      window.logseq.UI.showMsg('Failed to read the file.', 'error');
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  const handleOpenDbPanel = async () => {
    setShowMcpPanel(false);
    setShowDbPanel(true);
    if (storageProvider.getDocumentCount) {
      try {
        const count = await storageProvider.getDocumentCount();
        setDocCount(count);
      } catch { /* ignore */ }
    }
    if (storageProvider.getPageCount) {
      try {
        const count = await storageProvider.getPageCount();
        setPageCount(count);
      } catch { /* ignore */ }
    }
    if (storageProvider.getDatabaseSize) {
      try {
        const size = await storageProvider.getDatabaseSize();
        setDbSize(size);
      } catch { /* ignore */ }
    }
  };

  const handleOpenMcpPanel = () => {
    setShowDbPanel(false);
    setShowMemoryPanel(false);
    setShowMcpPanel(prev => !prev);
  };

  const handleOpenMemoryPanel = () => {
    setShowDbPanel(false);
    setShowMcpPanel(false);
    setShowMemoryPanel(prev => !prev);
  };

  if (!isVisible) return null;

  const buttonProps = getButtonState({ isIndexing, isCooldownActive: cooldownActive });

  return (
    <Overlay onClick={e => {
      if (!panelRef.current?.contains(e.target as Node)) window.logseq.hideMainUI();
    }}>
      <ChatPanel ref={panelRef} className={themeMode === 'dark' ? darkTheme.className : ''}>
        <Header>
          <HeaderLeft>
            <LogoIcon src={themeMode === 'dark' ? 'icon-dark-transparent.png' : 'icon.png'} alt="Mixer Logo" />
            <Title>Mixer</Title>
          </HeaderLeft>
          <HeaderRight>
            <ModelSelect
              value={currentModel}
              onChange={handleModelChange}
              aria-label="Select Model"
              title="Select Model"
            >
              {modelChoices.map((choice) => (
                <option key={choice} value={choice}>
                  {choice}
                </option>
              ))}
            </ModelSelect>
            <HeaderButton onClick={handleNewSession} aria-label="New Session" title="New Session">✨ New</HeaderButton>
            <CloseButton onClick={() => window.logseq.hideMainUI()} aria-label="Close" title="Close">✕</CloseButton>
          </HeaderRight>
        </Header>

        <MessagesContainer id="messages-container" className={ctrlHeld ? 'ctrl-held' : ''}>
          <ChatMessageList
            messages={messages}
            editResults={editResults}
            getBlockMetadata={(uuid) => {
              const provider = storageProvider as any;
              return provider.getBlockMetadata?.(uuid) ?? null;
            }}
            onFileReattach={(file) => setAttachedFiles(prev => [...prev, file])}
            onImageReattach={(image) => setImageDataUrls(prev => [...prev, image])}
          />
          {agentPlan && (
            <AgentProgress
              plan={agentPlan}
              onApprove={() => { setAgentRunning(true); agentLoopRef.current?.run(agentPlan); }}
              onCancel={() => { setAgentPlan(null); setAgentRunning(false); }}
              onStop={() => { agentAbortRef.current?.abort(); agentAbortRef.current = null; setAgentRunning(false); }}
              onEscalationResponse={(answer) => { escalationResolverRef.current?.(answer); setEscalationQuestion(null); }}
              tokensUsed={agentTokensUsed}
              tokenBudget={settings?.agentTokenBudget || 100000}
              escalationQuestion={escalationQuestion}
              isRunning={agentRunning}
              onReplanResponse={(approved) => { replanResolverRef.current?.(approved); setReplanReason(null); setReplanSteps([]); }}
              replanReason={replanReason}
              replanSteps={replanSteps}
              verbose={verboseMode}
              onRetryStep={(stepId) => {
                setAgentPlan(prev => prev ? { ...prev, steps: prev.steps.map(s => s.id === stepId ? { ...s, status: 'pending' as const, error: undefined } : s) } : prev);
              }}
              onSkipStep={(stepId) => {
                setAgentPlan(prev => prev ? { ...prev, steps: prev.steps.map(s => s.id === stepId ? { ...s, status: 'skipped' as const } : s) } : prev);
              }}
            />
          )}
          {loading && (
            <>
              <TypingIndicator>
                <Dot delay={0} /><Dot delay={1} /><Dot delay={2} />
              </TypingIndicator>
              {thinkingText && <div style={{ fontSize: 11, color: '#6b7280', padding: '4px 16px', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>💭 {thinkingText.slice(0, 100)}</div>}
            </>
          )}
          <div ref={messagesEndRef} />
        </MessagesContainer>

        {error && (
          <ErrorBanner>
            <span>⚠️</span>
            <span style={{ flex: 1 }}>{error}</span>
            <RetryButton onClick={handleSubmit}>Retry</RetryButton>
          </ErrorBanner>
        )}

        <InputArea>
          {imageDataUrls.length > 0 && (
            <div style={{ padding: '4px 8px', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              {imageDataUrls.map((img, i) => (
                <span key={i} style={{ position: 'relative', display: 'inline-block' }}>
                  <img src={img.content} alt={img.name} style={{ maxHeight: 48, maxWidth: 80, borderRadius: 4 }} />
                  <button onClick={() => setImageDataUrls(prev => prev.filter((_, idx) => idx !== i))} style={{ position: 'absolute', top: -4, right: -4, background: 'rgba(0,0,0,0.6)', color: 'white', border: 'none', borderRadius: '50%', width: 16, height: 16, fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                </span>
              ))}
            </div>
          )}
          {attachedFiles.length > 0 && (
            <div style={{ padding: '4px 8px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px', fontSize: 12 }}>
              {attachedFiles.map((f, i) => (
                <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: '2px', background: 'rgba(0,0,0,0.05)', borderRadius: 4, padding: '1px 6px' }}>
                  📎 {f.name}
                  <button onClick={() => setAttachedFiles(prev => prev.filter((_, idx) => idx !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, padding: 0 }}>✕</button>
                </span>
              ))}
            </div>
          )}
          <InputWrapper>
            <input
              ref={imageFileRef}
              type="file"
              accept="*/*"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => { if (e.target.files) { Array.from(e.target.files).forEach(handleFile); } e.target.value = ''; }}
            />
            <ImageButton onClick={() => imageFileRef.current?.click()} aria-label="Attach file" title="Attach file" disabled={loading}>
              <svg viewBox="0 0 24 24" width="18" height="18"><path d="M16.5 6v11.5a4 4 0 0 1-8 0V5a2.5 2.5 0 0 1 5 0v10.5a1 1 0 0 1-2 0V6h-1v9.5a2 2 0 0 0 4 0V5a3.5 3.5 0 0 0-7 0v12.5a5 5 0 0 0 10 0V6h-1z" fill="currentColor"/></svg>
            </ImageButton>
            <TextArea
              ref={textareaRef}
              placeholder={loading ? 'Thinking...' : 'Ask about your notes...'}
              value={inputMessage}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              disabled={loading}
              rows={4}
            />
            {loading ? (
              <SendButton onClick={handleCancel} aria-label="Cancel" title="Cancel" css={{ backgroundColor: '$red9', '&:hover:not(:disabled)': { backgroundColor: '$red10' } }}>
                <svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
              </SendButton>
            ) : (
              <SendButton onClick={handleSubmit} disabled={!inputMessage.trim()} aria-label="Send" title="Send">
                <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" /></svg>
              </SendButton>
            )}
          </InputWrapper>
          <ToolbarRow>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AutoEmbedToggle enabled={autoEmbedEnabled} onToggle={handleAutoEmbedToggle} />
              <EditToggle enabled={aiEditMode} onToggle={() => setAiEditMode(prev => !prev)} />
              <AgentToggle enabled={agentModeOn} onToggle={handleAgentModeToggle} />
              <VerboseToggle enabled={verboseMode} onToggle={handleVerboseToggle} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <ToolbarButton onClick={handleOpenDbPanel} title="Database">🗄️</ToolbarButton>
              <ToolbarButton onClick={handleOpenMcpPanel} title="MCP Servers">🔌</ToolbarButton>
              <ToolbarButton onClick={handleOpenMemoryPanel} title="Memory">
                🧠{memoryCount > 0 && <span style={{ fontSize: '10px', backgroundColor: '#3b82f6', color: 'white', borderRadius: '50%', padding: '1px 5px', marginLeft: '2px' }}>{memoryCount}</span>}{isSummarizing && <span style={{ marginLeft: '2px' }}>⏳</span>}
              </ToolbarButton>
              <ToolbarButton
                variant={buttonProps.variant}
                onClick={handleIndexDB}
                disabled={buttonProps.disabled}
                title="Re-Index"
                css={buttonProps.disabled ? { opacity: 0.5, cursor: 'default' } : undefined}
              >
                {buttonProps.label}
              </ToolbarButton>
            </div>
          </ToolbarRow>
          <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2, paddingLeft: 2 }}>
            {isIndexing ? (
              <span>Indexing… {progressCount} pages processed</span>
            ) : indexingStatus?.outcome === 'completed' ? (
              <span style={isDismissing ? { opacity: 0 } : undefined}>✓ Indexing complete · {docCount?.toLocaleString()} chunks{pageCount ? ` · ${pageCount.toLocaleString()} pages` : ''}</span>
            ) : indexingStatus?.outcome === 'paused' ? (
              <span>⏸ Indexing paused</span>
            ) : docCount !== null ? (
              <span>📊 {docCount.toLocaleString()} chunks{pageCount ? ` · ${pageCount.toLocaleString()} pages` : ''}</span>
            ) : null}
          </div>
          <div style={{ fontSize: 11, color: activePageName ? '#6b7280' : '#f59e0b', marginTop: 4, paddingLeft: 2 }}>
            {activePageName ? `📄 ${activePageName}` : '⚠ No active page'}
            {activeBlockContent && <span style={{ color: '#9ca3af', marginLeft: '8px' }}>▸ {activeBlockContent}{activeBlockContent.length >= 50 ? '…' : ''}</span>}
          </div>
        </InputArea>

        {showMcpPanel && <MCPServerPanel onClose={() => setShowMcpPanel(false)} />}
        {showMemoryPanel && (
          <MemoryPanel
            onClose={() => setShowMemoryPanel(false)}
            memoryStore={memoryStoreInstance}
            memoryEnabled={(settings?.memoryEnabled as boolean) ?? true}
            onCountChange={setMemoryCount}
          />
        )}
        {showDbPanel && (
          <DbPanel>
            <DbPanelHeader>
              <DbPanelTitle>🗄️ Database Center</DbPanelTitle>
              <CloseButton onClick={() => setShowDbPanel(false)} aria-label="Close Database Panel">✕</CloseButton>
            </DbPanelHeader>

            <DbStatsList>
              {dbSize !== null && (
                <DbStatRow>
                  <DbStatLabel>Database Size</DbStatLabel>
                  <DbStatValue>{formatBytes(dbSize)}</DbStatValue>
                </DbStatRow>
              )}
              <DbStatRow>
                <DbStatLabel>Indexed Pages</DbStatLabel>
                <DbStatValue>
                  {pageCount !== null ? pageCount.toLocaleString() : '0'}
                </DbStatValue>
              </DbStatRow>
              <DbStatRow>
                <DbStatLabel>Indexed Chunks (Vectors)</DbStatLabel>
                <DbStatValue>
                  {docCount !== null ? docCount.toLocaleString() : '0'}
                </DbStatValue>
              </DbStatRow>
              <DbStatRow>
                <DbStatLabel>Embedding Provider</DbStatLabel>
                <DbStatValue style={{ textTransform: 'capitalize' }}>
                  {settings?.embeddingProvider || 'OpenAI'}
                </DbStatValue>
              </DbStatRow>
              <DbStatRow>
                <DbStatLabel>Embedding Model</DbStatLabel>
                <DbStatValue>
                  {settings?.embeddingModel || 'text-embedding-3-small'}
                </DbStatValue>
              </DbStatRow>
            </DbStatsList>

            <DbPanelActions>
              {storageProvider.exportToFile && (
                <DbPanelButton variant="primary" onClick={() => storageProvider.exportToFile?.()}>
                  📤 Export SQLite DB
                </DbPanelButton>
              )}
              {storageProvider.importFromFile && (
                <>
                  <input
                    type="file"
                    accept=".sqlite,.db"
                    ref={fileInputRef}
                    onChange={handleImportFileChange}
                    style={{ display: 'none' }}
                  />
                  <DbPanelButton variant="primary" onClick={() => fileInputRef.current?.click()}>
                    📥 Import SQLite DB
                  </DbPanelButton>
                </>
              )}
              <DbPanelButton variant="secondary" onClick={() => setShowDbPanel(false)}>
                Close
              </DbPanelButton>
              {!confirmClearDb ? (
                <DbPanelButton variant="secondary" title="Clear all indexed data" onClick={() => setConfirmClearDb(true)} css={{ borderColor: '$red7', color: '$red11', '&:hover': { backgroundColor: '$red3', borderColor: '$red8', color: '$red11' } }}>
                  🗑️ Clear Database
                </DbPanelButton>
              ) : (
                <div style={{ display: 'flex', flex: 1, gap: '6px', alignItems: 'center', backgroundColor: '#fee2e2', padding: '8px 12px', borderRadius: '8px', border: '1px solid #fca5a5' }}>
                  <span style={{ fontSize: '12px', color: '#991b1b', flex: 1 }}>Delete all indexed data?</span>
                  <DbPanelButton variant="secondary" onClick={async () => {
                    try {
                      await storageProvider.clear();
                      setDocCount(0);
                      setPageCount(0);
                      if (storageProvider.getDatabaseSize) setDbSize(await storageProvider.getDatabaseSize());
                      window.logseq.UI.showMsg('Database cleared successfully. Please re-index.', 'success');
                    } catch (err: any) {
                      window.logseq.UI.showMsg(`Failed to clear database: ${err.message}`, 'error');
                    }
                    setConfirmClearDb(false);
                  }} css={{ borderColor: '$red7', color: 'white', backgroundColor: '$red9', '&:hover': { backgroundColor: '$red10' }, flex: 'none' }}>
                    Yes, clear
                  </DbPanelButton>
                  <DbPanelButton variant="secondary" onClick={() => setConfirmClearDb(false)} css={{ flex: 'none' }}>
                    Cancel
                  </DbPanelButton>
                </div>
              )}
            </DbPanelActions>
          </DbPanel>
        )}
      </ChatPanel>
    </Overlay>
  );
}

export default App;
