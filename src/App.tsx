import { AppUserConfigs } from '@logseq/libs/dist/LSPlugin';
import ChatMessageList, { ChatMessage } from 'components/ChatMessageList';
import { useThemeMode } from 'hooks/useThemeMode';
import type { IndexingResult } from 'indexManager';
import { cancelAutoIndexDebounce, getIndexingProgress, isIndexingActive, requestPauseIndexing, setAutoEmbedEnabled as setAutoEmbedEnabledIM, setAutoIndexDebounceSeconds } from 'indexManager';
import { clearConversationHistory, enableAutoIndexer, handleQuery, indexEntireLogSeq, verifyResponse } from 'manager';
import React, { KeyboardEvent, useEffect, useRef, useState } from 'react';
import { useRecoilState, useRecoilValue } from 'recoil';
import { executeAll, verifyAndCorrect } from './blockExecutor';
import { getActivePageContext } from './blockTreeFormatter';
import { getButtonState } from './buttonState';
import { AutoEmbedToggle } from './components/AutoEmbedToggle';
import { ChangeSummary } from './components/ChangeSummary';
import { EditToggle } from './components/EditToggle';
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

const LogoIcon = styled('span', { fontSize: '18px' });

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
  const abortControllerRef = useRef<AbortController | null>(null);
  const [docCount, setDocCount] = useState<number | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [dbSize, setDbSize] = useState<number | null>(null);
  const [indexingStatus, setIndexingStatus] = useState<IndexingResult | null>(null);
  const [isDismissing, setIsDismissing] = useState(false);
  const [progressCount, setProgressCount] = useState(getIndexingProgress);
  const [autoEmbedEnabled, setAutoEmbedEnabled] = useState(() => (logseq.settings?.autoEmbedEnabled as boolean) ?? true);
  const [cooldownActive, setCooldownActive] = useState(false);
  const [showDbPanel, setShowDbPanel] = useState(false);

  // Cancel cooldown timer on unmount
  useEffect(() => {
    return () => { cancelCooldown(); };
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
  }, [messages, loading]);

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
      };
      setMessages(prev => [...prev, userMessage]);
    }
    setLoading(true);
    setError(null);
    setInputMessage('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

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

      const resp = await handleQuery(messageToSend, settings, storageProvider, controller.signal, effectiveEditMode);
      abortControllerRef.current = null;

      if (aiEditMode && typeof resp === 'object' && resp !== null && 'text' in resp) {
        const editResp = resp;
        const assistantMsgId = Date.now() + '_assistant';
        setMessages(prev => [...prev, {
          id: assistantMsgId,
          content: editResp.text,
          sender: 'assistant',
        }]);

        if (editResp.commands.length > 0) {
          const result = await executeAll(editResp.commands);
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
      } else {
        const responseText = typeof resp === 'string' ? resp : resp.text;
        const assistantMsgId = Date.now() + '_assistant';
        setMessages(prev => [...prev, {
          id: assistantMsgId,
          content: responseText,
          sender: 'assistant',
        }]);

        // Verify long responses for correctness
        const verification = await verifyResponse(messageToSend, responseText, settings);
        if (verification?.corrected) {
          setMessages(prev => prev.map(m =>
            m.id === assistantMsgId ? { ...m, content: verification.correctedResponse } : m
          ));
          setMessages(prev => [...prev, {
            id: Date.now() + '_verify',
            content: `⚠️ The previous response was reviewed and corrected.\n\n**What was fixed:** ${verification.explanation}`,
            sender: 'assistant',
          }]);
        }
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
    setMessages([]);
    setInputMessage('');
    setError(null);
    setAiEditMode(false);
    setEditResults(new Map());
    clearConversationHistory();
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

  const currentModel = settings?.selectedModel || 'gpt-3.5-turbo';
  const [fetchedModels, setFetchedModels] = useState<string[]>(MODEL_CHOICES);

  useEffect(() => {
    const loadModels = async () => {
      if (settings?.LiteLLMLink) {
        try {
          const models = await fetchLiteLLMModels(settings.LiteLLMLink, settings.apiKey || '');
          if (models && models.length > 0) {
            setFetchedModels(models);
          }
        } catch (err) {
          console.warn('Failed to fetch models from LiteLLM, using default list:', err);
        }
      }
    };
    loadModels();
  }, [settings?.LiteLLMLink, settings?.apiKey]);

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

    const confirmed = window.confirm(
      "WARNING: Importing a new database will completely overwrite your current database. This action cannot be undone.\n\nAre you sure you want to proceed?"
    );

    if (!confirmed) {
      e.target.value = '';
      return;
    }

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

  if (!isVisible) return null;

  const buttonProps = getButtonState({ isIndexing, isCooldownActive: cooldownActive });

  return (
    <Overlay onClick={e => {
      if (!panelRef.current?.contains(e.target as Node)) window.logseq.hideMainUI();
    }}>
      <ChatPanel ref={panelRef} className={themeMode === 'dark' ? darkTheme.className : ''}>
        <Header>
          <HeaderLeft>
            <LogoIcon>✍️</LogoIcon>
            <Title>Mixer</Title>
          </HeaderLeft>
          <HeaderRight>
            <ModelSelect
              value={currentModel}
              onChange={handleModelChange}
              aria-label="Select Model"
            >
              {modelChoices.map((choice) => (
                <option key={choice} value={choice}>
                  {choice}
                </option>
              ))}
            </ModelSelect>
            <HeaderButton onClick={handleNewSession} aria-label="New Session">✨ New</HeaderButton>
            <CloseButton onClick={() => window.logseq.hideMainUI()} aria-label="Close">✕</CloseButton>
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
          />
          {loading && (
            <TypingIndicator>
              <Dot delay={0} /><Dot delay={1} /><Dot delay={2} />
            </TypingIndicator>
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
          <InputWrapper>
            <TextArea
              ref={textareaRef}
              placeholder={loading ? 'Thinking...' : 'Ask about your notes...'}
              value={inputMessage}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              disabled={loading}
              rows={4}
            />
            {loading ? (
              <SendButton onClick={handleCancel} aria-label="Cancel" css={{ backgroundColor: '$red9', '&:hover:not(:disabled)': { backgroundColor: '$red10' } }}>
                <svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
              </SendButton>
            ) : (
              <SendButton onClick={handleSubmit} disabled={!inputMessage.trim()} aria-label="Send">
                <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" /></svg>
              </SendButton>
            )}
          </InputWrapper>
          <ToolbarRow>
            {isIndexing ? (
              <StatusIndicator variant="progress">
                Indexing… {progressCount} pages processed
              </StatusIndicator>
            ) : indexingStatus?.outcome === 'completed' ? (
              <StatusIndicator variant="success" dismissing={isDismissing || undefined}>
                ✓ Indexing complete — {docCount?.toLocaleString()} chunks indexed{pageCount ? ` from ${pageCount.toLocaleString()} pages` : ''}
              </StatusIndicator>
            ) : indexingStatus?.outcome === 'paused' ? (
              <StatusIndicator variant="paused">
                ⏸ Indexing paused
              </StatusIndicator>
            ) : (
              <StatusText>
                {docCount !== null && <>📊 {docCount.toLocaleString()} chunks indexed{pageCount ? ` from ${pageCount.toLocaleString()} pages` : ''}</>}
              </StatusText>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <AutoEmbedToggle enabled={autoEmbedEnabled} onToggle={handleAutoEmbedToggle} />
              <EditToggle enabled={aiEditMode} onToggle={() => setAiEditMode(prev => !prev)} />
              <ToolbarButton onClick={handleOpenDbPanel}>🗄️ Database</ToolbarButton>
              <ToolbarButton
                variant={buttonProps.variant}
                onClick={handleIndexDB}
                disabled={buttonProps.disabled}
                css={buttonProps.disabled ? { opacity: 0.5, cursor: 'default' } : undefined}
              >
                {buttonProps.label}
              </ToolbarButton>
            </div>
          </ToolbarRow>
        </InputArea>

        {showDbPanel && (
          <DbPanel>
            <DbPanelHeader>
              <DbPanelTitle>🗄️ Database Center</DbPanelTitle>
              <CloseButton onClick={() => setShowDbPanel(false)} aria-label="Close Database Panel">✕</CloseButton>
            </DbPanelHeader>

            <DbStatsList>
              <DbStatRow>
                <DbStatLabel>Storage Backend</DbStatLabel>
                <DbStatValue style={{ textTransform: 'capitalize' }}>
                  {settings?.storageBackend || 'SQLite'}
                </DbStatValue>
              </DbStatRow>
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
            </DbPanelActions>
          </DbPanel>
        )}
      </ChatPanel>
    </Overlay>
  );
}

export default App;
