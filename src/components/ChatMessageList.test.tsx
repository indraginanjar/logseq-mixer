/**
 * Integration tests for ChatMessageList component
 *
 * **Validates: Requirements 1.4, 2.1, 2.5**
 */

// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Mock stitches config — render styled components as plain HTML elements
vi.mock('../stitches.config', () => {
  const styled = (tag: string, _styles?: any) => {
    const Component = React.forwardRef((props: any, ref: any) => {
      const { css: _css, ...rest } = props;
      return React.createElement(tag, { ...rest, ref });
    });
    Component.displayName = `Styled(${tag})`;
    return Component;
  };
  return {
    styled,
    keyframes: () => 'mock-keyframe',
    darkTheme: { className: 'dark' },
    css: () => '',
  };
});

// Mock react-markdown to exercise the components.a override
vi.mock('react-markdown', () => {
  return {
    __esModule: true,
    default: ({ children, components }: { children: string; components?: any }) => {
      // Parse markdown link patterns [text](href) and render via components.a if provided
      const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
      const parts: React.ReactNode[] = [];
      let lastIndex = 0;
      let match: RegExpExecArray | null;
      let key = 0;

      const content = typeof children === 'string' ? children : '';

      while ((match = linkRegex.exec(content)) !== null) {
        // Add text before the link
        if (match.index > lastIndex) {
          parts.push(content.slice(lastIndex, match.index));
        }

        const linkText = match[1];
        const href = match[2];

        if (components?.a) {
          // Use the custom a component override — this is the key integration point
          parts.push(
            <React.Fragment key={key++}>
              {components.a({ href, children: linkText })}
            </React.Fragment>
          );
        } else {
          parts.push(<a key={key++} href={href}>{linkText}</a>);
        }

        lastIndex = linkRegex.lastIndex;
      }

      // Add remaining text
      if (lastIndex < content.length) {
        parts.push(content.slice(lastIndex));
      }

      return <div data-testid="markdown">{parts.length > 0 ? parts : content}</div>;
    },
  };
});

// Setup logseq global mock
beforeAll(() => {
  (globalThis as any).logseq = {
    App: {
      pushState: vi.fn(),
    },
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

import ChatMessageList, { ChatMessage } from './ChatMessageList';

describe('ChatMessageList integration', () => {
  /**
   * Requirement 2.1, 2.5: Assistant messages with [[page]] patterns render PageLink components inline
   */
  it('renders PageLink for assistant messages with [[page]] patterns', () => {
    const messages: ChatMessage[] = [
      { id: 1, content: 'Check out [[My Page]] for details', sender: 'assistant' },
    ];

    const { container } = render(<ChatMessageList messages={messages} />);

    // PageLink renders as a <span> with an onClick handler
    // When children are provided (from ReactMarkdown's components.a), PageLink renders children text
    const spans = container.querySelectorAll('span');
    const pageLinkSpan = Array.from(spans).find((s) => s.textContent === 'My Page');
    expect(pageLinkSpan).toBeTruthy();
    // The surrounding text should also be present
    expect(container.textContent).toContain('Check out');
    expect(container.textContent).toContain('for details');
  });

  it('renders multiple PageLinks for assistant messages with multiple [[page]] patterns', () => {
    const messages: ChatMessage[] = [
      { id: 1, content: 'See [[Page A]] and [[Page B]]', sender: 'assistant' },
    ];

    const { container } = render(<ChatMessageList messages={messages} />);

    const spans = container.querySelectorAll('span');
    const spanTexts = Array.from(spans).map((s) => s.textContent);
    expect(spanTexts).toContain('Page A');
    expect(spanTexts).toContain('Page B');
  });

  /**
   * Requirement 1.4: User messages are not transformed — [[page]] stays as raw text
   */
  it('does not transform user messages', () => {
    const messages: ChatMessage[] = [
      { id: 1, content: 'What about [[My Page]]?', sender: 'user' },
    ];

    const { container } = render(<ChatMessageList messages={messages} />);
    const text = container.textContent || '';

    // User message content is passed as-is to ReactMarkdown (no transformation)
    // The raw [[My Page]] text should appear without being converted to a PageLink
    expect(text).toContain('[[My Page]]');

    // There should be no span with onClick (PageLink renders as a span)
    const spans = container.querySelectorAll('span[class]');
    // PageLink spans would have an onClick handler; user messages should not produce them
    const pageLinks = Array.from(spans).filter((s) => s.textContent?.includes('[['));
    expect(pageLinks).toHaveLength(0);
  });

  /**
   * Requirement 1.4: Messages without [[...]] patterns render normally
   */
  it('renders messages without [[...]] patterns as normal text', () => {
    const messages: ChatMessage[] = [
      { id: 1, content: 'Hello, this is a plain message.', sender: 'assistant' },
    ];

    const { container } = render(<ChatMessageList messages={messages} />);
    const text = container.textContent || '';

    expect(text).toContain('Hello, this is a plain message.');
  });

  it('renders empty message list with empty state', () => {
    const { container } = render(<ChatMessageList messages={[]} />);
    const text = container.textContent || '';

    expect(text).toContain('Start a conversation');
  });

  /**
   * Requirement 2.5: PageLink is rendered inline within surrounding text
   */
  it('renders PageLink inline with surrounding text', () => {
    const messages: ChatMessage[] = [
      { id: 1, content: 'Before [[TestPage]] after', sender: 'assistant' },
    ];

    const { container } = render(<ChatMessageList messages={messages} />);
    const text = container.textContent || '';

    // The full text should flow naturally with the page name inline
    expect(text).toContain('Before');
    expect(text).toContain('TestPage');
    expect(text).toContain('after');

    // PageLink renders as an inline <span>
    const spans = container.querySelectorAll('span');
    const pageLinkSpan = Array.from(spans).find((s) => s.textContent === 'TestPage');
    expect(pageLinkSpan).toBeTruthy();
  });

  /**
   * Requirement 2.1: PageLink for assistant messages with special characters in page names
   */
  it('handles page names with special characters', () => {
    const messages: ChatMessage[] = [
      { id: 1, content: 'See [[Page/With Specials]]', sender: 'assistant' },
    ];

    const { container } = render(<ChatMessageList messages={messages} />);
    const text = container.textContent || '';

    expect(text).toContain('Page/With Specials');
  });

  /**
   * Non-logseq links should fall through to CtrlLink, not PageLink
   */
  it('renders regular links as CtrlLink, not PageLink', () => {
    const messages: ChatMessage[] = [
      { id: 1, content: 'Visit [example](https://example.com)', sender: 'assistant' },
    ];

    const { container } = render(<ChatMessageList messages={messages} />);

    // CtrlLink renders as an <a> tag with class "ctrl-link"
    const ctrlLinks = container.querySelectorAll('a.ctrl-link');
    expect(ctrlLinks.length).toBe(1);
    expect(ctrlLinks[0].getAttribute('href')).toBe('https://example.com');
  });
});
