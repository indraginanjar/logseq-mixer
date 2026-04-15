import React from 'react';
import ReactMarkdown from 'react-markdown';
import { keyframes, styled } from '../stitches.config';
import { CtrlLink } from './CtrlLink';

export type ChatMessage = {
  id: string | number;
  content: string;
  sender: 'user' | 'assistant';
};

const fadeIn = keyframes({
  '0%': { opacity: 0, transform: 'translateY(8px)' },
  '100%': { opacity: 1, transform: 'translateY(0)' },
});

const Container = styled('div', {
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
});

const MessageRow = styled('div', {
  display: 'flex',
  gap: '8px',
  animation: `${fadeIn} 0.25s ease-out both`,
  variants: {
    align: {
      user: { justifyContent: 'flex-end' },
      assistant: { justifyContent: 'flex-start' },
    },
  },
});

const Avatar = styled('div', {
  width: '28px',
  height: '28px',
  borderRadius: '50%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '13px',
  fontWeight: '600',
  flexShrink: 0,
  marginTop: '2px',
  variants: {
    role: {
      user: {
        backgroundColor: '$blue4',
        color: '$blue11',
      },
      assistant: {
        backgroundColor: '$violet4',
        color: '$violet11',
      },
    },
  },
});

const Bubble = styled('div', {
  maxWidth: '80%',
  padding: '10px 14px',
  borderRadius: '12px',
  fontSize: '14px',
  lineHeight: 1.6,
  wordBreak: 'break-word',
  overflowWrap: 'break-word',
  // Markdown content styling
  '& p': { margin: '0 0 8px 0', '&:last-child': { marginBottom: 0 } },
  '& pre': {
    backgroundColor: '$slate3',
    borderRadius: '6px',
    padding: '10px 12px',
    overflow: 'auto',
    fontSize: '13px',
    margin: '8px 0',
  },
  '& code': {
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
    fontSize: '13px',
  },
  '& :not(pre) > code': {
    backgroundColor: '$slate3',
    padding: '2px 5px',
    borderRadius: '4px',
  },
  '& ul, & ol': { margin: '4px 0', paddingLeft: '20px' },
  '& li': { marginBottom: '2px' },
  '& blockquote': {
    borderLeft: '3px solid $slate7',
    margin: '8px 0',
    paddingLeft: '12px',
    color: '$slate11',
  },
  variants: {
    role: {
      user: {
        backgroundColor: '$blue4',
        color: '$blue12',
        borderBottomRightRadius: '4px',
      },
      assistant: {
        backgroundColor: '$slate2',
        border: '1px solid $slate6',
        color: '$slate12',
        borderBottomLeftRadius: '4px',
      },
    },
  },
});

const EmptyState = styled('div', {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '48px 24px',
  color: '$slate9',
  textAlign: 'center',
  gap: '8px',
});

const EmptyIcon = styled('div', {
  fontSize: '32px',
  marginBottom: '4px',
});

export default function ChatMessageList({ messages }: { messages: ChatMessage[] }) {
  if (messages.length === 0) {
    return (
      <EmptyState>
        <EmptyIcon>💬</EmptyIcon>
        <div style={{ fontSize: '15px', fontWeight: 500 }}>Start a conversation</div>
        <div style={{ fontSize: '13px' }}>
          Ask anything about your notes. Press Enter to send.
        </div>
      </EmptyState>
    );
  }

  return (
    <Container>
      {messages.map((msg) => (
        <MessageRow key={msg.id} align={msg.sender}>
          {msg.sender === 'assistant' && <Avatar role="assistant">AI</Avatar>}
          <Bubble role={msg.sender}>
            <ReactMarkdown components={{ a: CtrlLink }}>{msg.content}</ReactMarkdown>
          </Bubble>
          {msg.sender === 'user' && <Avatar role="user">U</Avatar>}
        </MessageRow>
      ))}
    </Container>
  );
}
