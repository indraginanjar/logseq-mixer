import React from 'react';
import ReactMarkdown from 'react-markdown';
import { keyframes, styled } from '../stitches.config';

export type ChatMessage = {
  id: string | number;
  content: string;
  sender: 'user' | 'assistant';
};

const slideInLeft = keyframes({
  '0%': { opacity: 0, transform: 'translateX(-30px)' },
  '100%': { opacity: 1, transform: 'translateX(0)' },
});

const slideInRight = keyframes({
  '0%': { opacity: 0, transform: 'translateX(30px)' },
  '100%': { opacity: 1, transform: 'translateX(0)' },
});

const Container = styled('div', {
  display: 'flex',
  flexDirection: 'column',
  gap: '16px',
});

// Base bubble styling with overflow wrapping for code blocks
const Bubble = styled('div', {
  maxWidth: '70%',
  padding: '12px',
  borderRadius: '8px',
  fontSize: '1rem',
  lineHeight: 1.5,
  wordBreak: 'break-word',
  overflowWrap: 'break-word',
  animationDuration: '0.3s',
  animationFillMode: 'both',
});

const UserBubble = styled(Bubble, {
  alignSelf: 'flex-end',
  backgroundColor: '#DFFFD8',
  animationName: `${slideInRight}`,
});

const AssistantBubble = styled(Bubble, {
  alignSelf: 'flex-start',
  backgroundColor: '#FFF',
  border: '1px solid #ddd',
  animationName: `${slideInLeft}`,
});

export default function ChatMessageList({ messages }: { messages: ChatMessage[] }) {
  return (
    <Container>
      {messages.map((msg) =>
        msg.sender === 'user' ? (
          <UserBubble key={msg.id}>
            <ReactMarkdown>{msg.content}</ReactMarkdown>
          </UserBubble>
        ) : (
          <AssistantBubble key={msg.id}>
            <ReactMarkdown>{msg.content}</ReactMarkdown>
          </AssistantBubble>
        )
      )}
    </Container>
  );
}
