import { AppUserConfigs } from '@logseq/libs/dist/LSPlugin';
import ChatMessageList, { ChatMessage } from 'components/ChatMessageList';
import { useThemeMode } from 'hooks/useThemeMode';
import { requestPauseIndexing } from 'indexManager';
import { enableAutoIndexer, handleQuery, indexEntireLogSeq } from 'manager';
import React, { KeyboardEvent, useEffect, useRef, useState } from 'react';
import { useRecoilValue } from 'recoil';
import { useAppVisible } from './hooks/useAppVisible';
import { settingsState } from './state/settings';
import { darkTheme, keyframes, styled } from './stitches.config';
import type { StorageProvider } from './storage/StorageProvider';

// --- Animations ---

const slideIn = keyframes({
  '0%': { transform: 'translateX(100%)' },
  '100%': { transform: 'translateX(0)' },
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

const MessagesContainer = styled('div', {
  flex: 1,
  overflowY: 'auto',
  padding: '16px',
  backgroundColor: '$elevation0',
  '&::-webkit-scrollbar': { width: '6px' },
  '&::-webkit-scrollbar-track': { background: 'transparent' },
  '&::-webkit-scrollbar-thumb': { background: '$slate6', borderRadius: '3px' },
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
  minHeight: '20px',
  maxHeight: '120px',
  resize: 'none',
  border: 'none',
  background: 'transparent',
  padding: 0,
  fontSize: '14px',
  fontFamily: 'inherit',
  lineHeight: 1.5,
  outline: 'none',
  color: '$highContrast',
  '&::placeholder': { color: '$slate8' },
  '&:disabled': { opacity: 0.5 },
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
  justifyContent: 'flex-end',
  gap: '6px',
  marginTop: '8px',
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
        backgroundColor: '$amber3',
        borderColor: '$amber7',
        color: '$amber11',
        '&:hover': { backgroundColor: '$amber4', borderColor: '$amber8', color: '$amber12' },
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

// --- Component ---

type Props = {
  themeMode: AppUserConfigs['preferredThemeMode'];
  storageProvider: StorageProvider;
};

export function App({ themeMode: initialThemeMode, storageProvider }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isVisible = useAppVisible();
  const themeMode = useThemeMode(initialThemeMode);
  const settings = useRecoilValue(settingsState);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isIndexing, setIsIndexing] = useState(false);

  const [inputHistory, setInputHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [savedDraft, setSavedDraft] = useState('');

  useEffect(() => {
    if (settings) enableAutoIndexer(settings, storageProvider);
  }, [settings]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputMessage(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  };

  const handleSubmit = async () => {
    if (!inputMessage.trim()) return;

    setInputHistory(prev => [...prev, inputMessage.trim()]);
    setHistoryIndex(-1);
    setSavedDraft('');

    const userMessage: ChatMessage = {
      id: Date.now() + '_user',
      content: inputMessage.trim(),
      sender: 'user',
    };
    setMessages(prev => [...prev, userMessage]);
    setLoading(true);
    setError(null);
    setInputMessage('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    try {
      const resp = await handleQuery(inputMessage.trim(), settings, storageProvider);
      setMessages(prev => [...prev, {
        id: Date.now() + '_assistant',
        content: resp,
        sender: 'assistant',
      }]);
    } catch (err: any) {
      console.error('Error in handleQuery:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
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
    if (isIndexing) { requestPauseIndexing(); return; }
    setIsIndexing(true);
    setError(null);
    try {
      await indexEntireLogSeq(settings, storageProvider);
    } catch (err: any) {
      setError(err.message || 'Indexing failed.');
    } finally {
      setIsIndexing(false);
    }
  };

  if (!isVisible) return null;

  return (
    <Overlay onClick={e => {
      if (!panelRef.current?.contains(e.target as Node)) window.logseq.hideMainUI();
    }}>
      <ChatPanel ref={panelRef} className={themeMode === 'dark' ? darkTheme.className : ''}>
        <Header>
          <HeaderLeft>
            <LogoIcon>✍️</LogoIcon>
            <Title>Composer</Title>
          </HeaderLeft>
          <CloseButton onClick={() => window.logseq.hideMainUI()} aria-label="Close">✕</CloseButton>
        </Header>

        <MessagesContainer id="messages-container">
          <ChatMessageList messages={messages} />
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
              rows={1}
            />
            <SendButton onClick={handleSubmit} disabled={loading || !inputMessage.trim()} aria-label="Send">
              <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" /></svg>
            </SendButton>
          </InputWrapper>
          <ToolbarRow>
            {storageProvider.exportToFile && (
              <ToolbarButton onClick={() => storageProvider.exportToFile?.()}>📥 Export</ToolbarButton>
            )}
            <ToolbarButton variant={isIndexing ? 'pause' : 'index'} onClick={handleIndexDB}>
              {isIndexing ? '⏸ Pause' : '🔄 Re-Index'}
            </ToolbarButton>
          </ToolbarRow>
        </InputArea>
      </ChatPanel>
    </Overlay>
  );
}

export default App;
