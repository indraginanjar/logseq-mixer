import React from 'react';
import ReactMarkdown from 'react-markdown';
import { styled } from '../stitches.config';

// A styled container similar to your TagList container.
const StyledAnswerList = styled('div', {
  display: 'flex',
  flexDirection: 'column-reverse',
  overflowY: 'auto',
  padding: '16px',
  gap: '16px',
});

// Define a type for a single ChatGPT answer.
export type ChatGPTAnswer = {
  id: string;
  content: string; // Markdown formatted text from ChatGPT
};

type Props = {
  answers: ChatGPTAnswer[];
};

export function ChatGPTAnswerList({ answers }: Props) {
  return (
    <StyledAnswerList>
      {answers.map(answer => (
        <div
          key={answer.id}
          style={{
            padding: '12px',
            border: '1px solid #ddd',
            borderRadius: '4px',
            backgroundColor: '#fff'
          }}
        >
          <ReactMarkdown>{answer.content}</ReactMarkdown>
        </div>
      ))}
    </StyledAnswerList>
  );
}

export default ChatGPTAnswerList;
