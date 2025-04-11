import { AppUserConfigs } from '@logseq/libs/dist/LSPlugin';
import ChatMessageList, { ChatMessage } from 'components/ChatMessageList';
import { useThemeMode } from 'hooks/useThemeMode';
import { enableAutoIndexer, handleQuery, indexEntireLogSeq } from 'manager';
import React, { KeyboardEvent, useEffect, useRef, useState } from 'react';
import { useRecoilValue } from 'recoil';
import { useAppVisible } from './hooks/useAppVisible';
import { settingsState } from './state/settings';
import { darkTheme, keyframes, styled } from './stitches.config';
// Overlay to dim the background
const Overlay = styled('div', {
  position: 'fixed',
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  zIndex: 99,
});

// Slide-in animation for the panel
const slideIn = keyframes({
  '0%': { transform: 'translateX(100%)', opacity: 0 },
  '100%': { transform: 'translateX(0)', opacity: 1 },
});

// Chat panel container
const ChatPanel = styled('main', {
  position: 'fixed',
  top: 0,
  right: 0,
  bottom: 0,
  width: '600px',
  maxWidth: '80%',
  backgroundColor: '#fff',
  boxShadow: '0 20px 25px -5px rgba(0,0,0,0.2)',
  display: 'flex',
  flexDirection: 'column',
  zIndex: 100,
  animation: `${slideIn} 0.3s ease-out`,
});

// Header styling with close button
const Header = styled('div', {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '16px',
  borderBottom: '1px solid #ddd',
});

const Title = styled('h2', {
  margin: 0,
  fontSize: '1.25rem',
});

const CloseButton = styled('button', {
  background: 'transparent',
  border: 'none',
  fontSize: '1.2rem',
  cursor: 'pointer',
  color: '#666',
  '&:hover': { color: '#000' },
});

// Messages container that scrolls
const MessagesContainer = styled('div', {
  flex: 1,
  overflowY: 'auto',
  padding: '16px',
  backgroundColor: '#f8f8f8',
});

// Input area styling
const InputArea = styled('div', {
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  padding: '16px',
  borderTop: '1px solid #ddd',
  backgroundColor: '#fff',
});

const TextArea = styled('textarea', {
  width: '100%',
  minHeight: '50px',
  resize: 'none',
  borderRadius: '4px',
  border: '1px solid #ccc',
  padding: '8px',
  fontSize: '1rem',
  fontFamily: 'inherit',
  outline: 'none',
  '&:focus': { borderColor: '#999' },
});

// Send button using an inline SVG icon (paper airplane)
const SendButton = styled('button', {
  backgroundColor: '#007bff',
  border: 'none',
  borderRadius: '4px',
  padding: '8px 16px',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#fff',
  fontSize: '1rem',
  transition: 'background-color 0.2s',
  '&:hover': { backgroundColor: '#0056b3' },
  svg: {
    width: '20px',
    height: '20px',
    fill: 'currentColor',
  },
});

// Extra "Index DB" button
const IndexDBButton = styled('button', {
  backgroundColor: '#28a745',
  border: 'none',
  borderRadius: '4px',
  padding: '8px 16px',
  cursor: 'pointer',
  color: '#fff',
  fontSize: '1rem',
  transition: 'background-color 0.2s',
  '&:hover': { backgroundColor: '#1e7e34' },
  alignSelf: 'flex-end',
  marginTop: '8px',
});

type Props = {
  themeMode: AppUserConfigs['preferredThemeMode'];
};

export function App({ themeMode: initialThemeMode }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isVisible = useAppVisible();
  const themeMode = useThemeMode(initialThemeMode);
  const settings = useRecoilValue(settingsState);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isIndexing, setIsIndexing] = useState(false);

  // Auto-scroll to bottom when messages update.
  useEffect(() => {
    if (settings) {
      enableAutoIndexer(settings);
    }
  }, [settings]); 
  
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = async () => {
    if (!inputMessage.trim()) return;
  
    const userMessage: ChatMessage = {
      id: Date.now() + '_user',
      content: inputMessage.trim(),
      sender: 'user',
    };
    setMessages(prev => [...prev, userMessage]);
  
    setLoading(true);
    setError(null);
    try {
      const assistantResponse = await handleQuery(inputMessage.trim(), settings);
      const assistantMessage: ChatMessage = {
        id: Date.now() + '_assistant',
        content: assistantResponse,
        sender: 'assistant',
      };
      setMessages(prev => [...prev, assistantMessage]);
    } catch (err: any) {
      console.error('Error in handleQuery:', err);
  
      setError(err.message);
    } finally {
      setLoading(false);
      setInputMessage('');
    }
  };
  

  // Handle Enter (without Shift for newline)
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Dummy handler for Index DB button
  const handleIndexDB = async () => {
    setIsIndexing(true);
    setError(null);
    try {
      console.log('Indexing started...');
      await indexEntireLogSeq(settings);
      console.log('Indexing done!');
    } catch (err: any) {
      console.error('Indexing error:', err);
      setError(err.message || 'Indexing failed. Please check your API key.');
    } finally {
      setIsIndexing(false);
    }
  };
  

  if (!isVisible) return null;

  return (
    <Overlay onClick={e => {
      // Close if click outside panel.
      if (!panelRef.current?.contains(e.target as Node)) {
        window.logseq.hideMainUI();
      }
    }}>
      <ChatPanel ref={panelRef} className={themeMode === 'dark' ? darkTheme.className : ''}>
        <Header>
          <Title>Chat with AI</Title>
          <CloseButton onClick={() => window.logseq.hideMainUI()}>✖</CloseButton>
        </Header>

        <MessagesContainer id="messages-container">
          <ChatMessageList messages={messages} />
          <div ref={messagesEndRef} />
        </MessagesContainer>

        {error && (
          <div style={{ color: 'red', padding: '0 16px' }}>
            {error} <button onClick={handleSubmit}>Retry</button>
          </div>
        )}

        <InputArea>
          <TextArea
            placeholder={loading ? 'Loading...' : 'Type your question...'}
            value={inputMessage}
            onChange={e => setInputMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
          />
          <div style={{ display: 'flex', gap: '8px',justifyContent: 'space-between' }}>
            <SendButton onClick={handleSubmit} disabled={loading}>
              {/* Inline SVG for paper airplane icon */}
              <svg viewBox="0 0 24 24">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
              </svg>
            </SendButton>
            <IndexDBButton onClick={handleIndexDB} disabled={isIndexing}>
              {isIndexing ? 'Indexing...' : 'Re-Index DB'}
            </IndexDBButton>
          </div>
        </InputArea>
      </ChatPanel>
    </Overlay>
  );
}

export default App;
