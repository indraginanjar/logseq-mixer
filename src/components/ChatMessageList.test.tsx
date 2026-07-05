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
      const { css: _css, active: _active, variant: _variant, delay: _delay, copied: _copied, ...rest } = props;
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

// Mock react-markdown to exercise the components.a and components.code overrides
vi.mock('react-markdown', () => {
  return {
    __esModule: true,
    default: ({ children, components }: { children: string; components?: any }) => {
      const content = typeof children === 'string' ? children : '';

      // Parse fenced code blocks
      const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
      const parts: React.ReactNode[] = [];
      let lastIndex = 0;
      let match: RegExpExecArray | null;
      let key = 0;

      while ((match = codeBlockRegex.exec(content)) !== null) {
        if (match.index > lastIndex) {
          parts.push(content.slice(lastIndex, match.index));
        }

        const lang = match[1] || '';
        const codeText = match[2];

        if (components?.code) {
          parts.push(
            <React.Fragment key={`code-block-${key++}`}>
              {components.code({
                node: {},
                inline: false,
                className: lang ? `language-${lang}` : '',
                children: codeText,
              })}
            </React.Fragment>
          );
        } else {
          parts.push(
            <pre key={`code-block-${key++}`} className={lang ? `language-${lang}` : ''}>
              <code className={lang ? `language-${lang}` : ''}>{codeText}</code>
            </pre>
          );
        }

        lastIndex = codeBlockRegex.lastIndex;
      }

      if (lastIndex < content.length) {
        parts.push(content.slice(lastIndex));
      }

      // Parse links on the non-element parts
      const finalParts = parts.map((part, i) => {
        if (typeof part !== 'string') return part;

        const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
        const subParts: React.ReactNode[] = [];
        let subLastIndex = 0;
        let subMatch: RegExpExecArray | null;
        let subKey = 0;

        while ((subMatch = linkRegex.exec(part)) !== null) {
          if (subMatch.index > subLastIndex) {
            subParts.push(part.slice(subLastIndex, subMatch.index));
          }

          const linkText = subMatch[1];
          const href = subMatch[2];

          if (components?.a) {
            subParts.push(
              <React.Fragment key={`link-${subKey++}`}>
                {components.a({ href, children: linkText })}
              </React.Fragment>
            );
          } else {
            subParts.push(<a key={`link-${subKey++}`} href={href}>{linkText}</a>);
          }

          subLastIndex = linkRegex.lastIndex;
        }

        if (subLastIndex < part.length) {
          subParts.push(part.slice(subLastIndex));
        }

        return <React.Fragment key={`part-${i}`}>{subParts}</React.Fragment>;
      });

      return <div data-testid="markdown">{finalParts}</div>;
    },
  };
});

// Setup logseq global mock
beforeAll(() => {
  (globalThis as any).logseq = {
    App: {
      pushState: vi.fn(),
    },
    Editor: {
      scrollToBlockInPage: vi.fn(),
    },
  };
  Object.defineProperty(navigator, 'clipboard', {
    value: {
      writeText: vi.fn().mockResolvedValue(undefined),
    },
    configurable: true,
  });
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

  /**
   * Requirement 8.1, 8.4: Assistant messages with ((uuid)) render BlockLink components
   */
  it('renders BlockLink for assistant messages with ((uuid)) patterns', () => {
    const mockGetBlockMetadata = vi.fn((uuid: string) => {
      if (uuid === 'ab-cd') {
        return { pageName: 'Test Page', contentPreview: 'Some block content' };
      }
      return null;
    });

    const messages: ChatMessage[] = [
      { id: 1, content: 'See ((ab-cd)) for details', sender: 'assistant' },
    ];

    const { container } = render(
      <ChatMessageList messages={messages} getBlockMetadata={mockGetBlockMetadata} />
    );

    // BlockLink renders as a <span> with the label text when placeholder children is provided
    const spans = container.querySelectorAll('span');
    const blockLinkSpan = Array.from(spans).find((s) => s.textContent === 'Some block content');
    expect(blockLinkSpan).toBeTruthy();

    // Surrounding text should be present
    expect(container.textContent).toContain('See');
    expect(container.textContent).toContain('for details');
  });

  /**
   * Requirement 8.1, 8.2: Messages with both [[page]] and ((uuid)) render both PageLink and BlockLink
   */
  it('renders both PageLink and BlockLink when message has [[page]] and ((uuid))', () => {
    const mockGetBlockMetadata = vi.fn((uuid: string) => {
      if (uuid === 'ab-cd') {
        return { pageName: 'Test Page', contentPreview: 'Block preview' };
      }
      return null;
    });

    const messages: ChatMessage[] = [
      { id: 1, content: 'See [[My Page]] and ((ab-cd))', sender: 'assistant' },
    ];

    const { container } = render(
      <ChatMessageList messages={messages} getBlockMetadata={mockGetBlockMetadata} />
    );

    const spans = container.querySelectorAll('span');
    const spanTexts = Array.from(spans).map((s) => s.textContent);

    // PageLink should render for [[My Page]]
    expect(spanTexts).toContain('My Page');
    // BlockLink should render for ((ab-cd))
    expect(spanTexts).toContain('Block preview');
  });

  /**
   * Requirement 8.3: User messages with ((uuid)) are NOT transformed
   */
  it('does not transform user messages containing ((uuid))', () => {
    const mockGetBlockMetadata = vi.fn(() => ({
      pageName: 'Test Page',
      contentPreview: 'Some content',
    }));

    const messages: ChatMessage[] = [
      { id: 1, content: 'What about ((ab-cd))?', sender: 'user' },
    ];

    const { container } = render(
      <ChatMessageList messages={messages} getBlockMetadata={mockGetBlockMetadata} />
    );

    const text = container.textContent || '';

    // User message should contain the raw ((ab-cd)) text, not a BlockLink
    expect(text).toContain('((ab-cd))');

    // getBlockMetadata should not have been called for user messages
    expect(mockGetBlockMetadata).not.toHaveBeenCalled();
  });

  /**
   * Requirement 8.3: Messages with only [[page]] render identically to existing behavior (no BlockLink)
   */
  it('renders only PageLink when message has [[page]] but no ((uuid))', () => {
    const mockGetBlockMetadata = vi.fn(() => null);

    const messages: ChatMessage[] = [
      { id: 1, content: 'Check out [[My Page]] for info', sender: 'assistant' },
    ];

    const { container } = render(
      <ChatMessageList messages={messages} getBlockMetadata={mockGetBlockMetadata} />
    );

    const spans = container.querySelectorAll('span');
    const spanTexts = Array.from(spans).map((s) => s.textContent);

    // PageLink should render
    expect(spanTexts).toContain('My Page');

    // No BlockLink should be rendered — getBlockMetadata should not be called
    // since there are no ((uuid)) patterns to trigger logseq://block/ links
    expect(mockGetBlockMetadata).not.toHaveBeenCalled();

    // Surrounding text should be intact
    expect(container.textContent).toContain('Check out');
    expect(container.textContent).toContain('for info');
  });

  /**
   * Tab support tests
   */
  it('renders tabs and supports switching between Code and Preview views', async () => {
    vi.useFakeTimers();
    const { fireEvent } = require('@testing-library/react');
    const { act } = require('@testing-library/react');
    const messages: ChatMessage[] = [
      {
        id: 1,
        content: 'Some introduction text:\n\n```markdown\n# Hello\nThis is **markdown** content\n```\n\nSome ending text.',
        sender: 'assistant',
      },
    ];

    const { container } = render(<ChatMessageList messages={messages} />);

    // The surrounding text should be rendered normally in the container
    expect(container.textContent).toContain('Some introduction text:');
    expect(container.textContent).toContain('Some ending text.');

    // Check that Code and Preview buttons are present
    const allButtons = Array.from(container.querySelectorAll('button'));
    const buttons = allButtons.filter(b => b.textContent === 'Code' || b.textContent === 'Preview');
    expect(buttons.length).toBe(2);
    expect(buttons[0].textContent).toBe('Code');
    expect(buttons[1].textContent).toBe('Preview');

    // Check initial active states using the mocked stitches active attributes
    expect(buttons[0].getAttribute('data-active')).toBe('true');
    expect(buttons[1].getAttribute('data-active')).toBe('false');

    // Check copy button is present when code tab is active
    const copyButton = allButtons.find(b => b.textContent?.includes('Copy'));
    expect(copyButton).toBeTruthy();
    const writeTextSpy = vi.spyOn(navigator.clipboard, 'writeText');
    await act(async () => {
      fireEvent.click(copyButton!);
    });
    expect(writeTextSpy).toHaveBeenCalledWith('# Hello\nThis is **markdown** content');
    writeTextSpy.mockRestore();

    // Simulate clicking the Preview button
    fireEvent.click(buttons[1]);

    // Check updated active states
    expect(buttons[0].getAttribute('data-active')).toBe('false');
    expect(buttons[1].getAttribute('data-active')).toBe('true');

    // Check copy button is present and works when preview tab is active
    const copyButtonOnPreview = allButtons.find(b => b.textContent?.includes('Copy'));
    expect(copyButtonOnPreview).toBeTruthy();
    const writeTextSpy2 = vi.spyOn(navigator.clipboard, 'writeText');
    await act(async () => {
      fireEvent.click(copyButtonOnPreview!);
    });
    expect(writeTextSpy2).toHaveBeenCalled();
    const copiedText = writeTextSpy2.mock.calls[0][0];
    expect(copiedText).toContain('Hello');
    expect(copiedText).toContain('markdown');
    writeTextSpy2.mockRestore();

    // Simulate clicking the Code button back
    fireEvent.click(buttons[0]);
    expect(buttons[0].getAttribute('data-active')).toBe('true');
    expect(buttons[1].getAttribute('data-active')).toBe('false');
    vi.useRealTimers();
  });

  /**
   * Logseq markdown extension tests
   */
  it('renders Logseq block properties, task badges, checkboxes, and tags', () => {
    const messages: ChatMessage[] = [
      {
        id: 1,
        content: 'public:: true\ncategory:: work\n- TODO task item\n- [ ] incomplete task\n- [x] completed task\nReferencing #[[my tag]] and #another-tag.',
        sender: 'assistant',
      },
    ];

    const { container } = render(<ChatMessageList messages={messages} />);

    // Assert block properties are rendered
    expect(container.textContent).toContain('public:');
    expect(container.textContent).toContain('true');
    expect(container.textContent).toContain('category:');
    expect(container.textContent).toContain('work');

    // Assert task badge (TODO) is rendered
    const spans = container.querySelectorAll('span');
    const spanTexts = Array.from(spans).map((s) => s.textContent);
    expect(spanTexts).toContain('TODO');

    // Assert checkboxes are rendered
    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    expect(checkboxes.length).toBe(2);
    expect((checkboxes[0] as HTMLInputElement).checked).toBe(false);
    expect((checkboxes[1] as HTMLInputElement).checked).toBe(true);

    // Assert tags are rendered
    expect(spanTexts).toContain('#my tag');
    expect(spanTexts).toContain('#another-tag');
  });

  /**
   * Logseq markdown table rendering test
   */
  it('renders markdown tables correctly', () => {
    const messages: ChatMessage[] = [
      {
        id: 1,
        content: 'Here is a table:\n\n| Item | Cost | Status |\n|---|---|---|\n| Book | $10 | DONE |\n| Pen | $2 | TODO |',
        sender: 'assistant',
      },
    ];

    const { container } = render(<ChatMessageList messages={messages} />);

    // Assert Code and Preview tab buttons are present
    const allButtons = Array.from(container.querySelectorAll('button'));
    const buttons = allButtons.filter(b => b.textContent === 'Code' || b.textContent === 'Preview');
    expect(buttons.length).toBe(2);
    expect(buttons[0].textContent).toBe('Code');
    expect(buttons[1].textContent).toBe('Preview');

    // Assert table element is rendered (in the Preview tab DOM)
    const table = container.querySelector('table');
    expect(table).toBeTruthy();

    // Assert headers are rendered
    const headers = container.querySelectorAll('th');
    expect(headers.length).toBe(3);
    expect(headers[0].textContent).toBe('Item');
    expect(headers[1].textContent).toBe('Cost');
    expect(headers[2].textContent).toBe('Status');

    // Assert cells are rendered
    const cells = container.querySelectorAll('td');
    expect(cells.length).toBe(6);
    expect(cells[0].textContent).toBe('Book');
    expect(cells[1].textContent).toBe('$10');
    expect(cells[2].textContent).toContain('DONE');
    expect(cells[3].textContent).toBe('Pen');
    expect(cells[4].textContent).toBe('$2');
    expect(cells[5].textContent).toContain('TODO');
  });

  it('renders markdown tables inside a markdown code fence with only one panel', () => {
    const messages: ChatMessage[] = [
      {
        id: 1,
        content: 'Check out this table:\n\n```markdown\n| Item | Cost |\n|---|---|\n| Book | $10 |\n```',
        sender: 'assistant',
      },
    ];

    const { container } = render(<ChatMessageList messages={messages} />);

    // There should be exactly one panel (2 buttons: Code and Preview)
    const allButtons = Array.from(container.querySelectorAll('button'));
    const buttons = allButtons.filter(b => b.textContent === 'Code' || b.textContent === 'Preview');
    expect(buttons.length).toBe(2);
    expect(buttons[0].textContent).toBe('Code');
    expect(buttons[1].textContent).toBe('Preview');

    // Inside the Preview tab, there should be a table
    const table = container.querySelector('table');
    expect(table).toBeTruthy();
  });

  it('does not render duplicate/empty panels when a markdown table is inside a bulleted code fence', () => {
    const messages: ChatMessage[] = [
      {
        id: 1,
        content: '- ```markdown\n| Item | Cost |\n|---|---|\n| Book | $10 |\n```',
        sender: 'assistant',
      },
    ];

    const { container } = render(<ChatMessageList messages={messages} />);

    // There should be exactly one panel (2 buttons: Code and Preview)
    const allButtons = Array.from(container.querySelectorAll('button'));
    const buttons = allButtons.filter(b => b.textContent === 'Code' || b.textContent === 'Preview');
    expect(buttons.length).toBe(2);
    expect(buttons[0].textContent).toBe('Code');
    expect(buttons[1].textContent).toBe('Preview');

    // Inside the Preview tab, there should be a table
    const table = container.querySelector('table');
    expect(table).toBeTruthy();
  });

  it('renders markdown tables without leading/trailing pipes', () => {
    const messages: ChatMessage[] = [
      {
        id: 1,
        content: 'Here is a table:\n\nPlugin | AI Features | Source\n--- | --- | ---\nLogseq AI | Chat with graph | github.com/example\nMixer | RAG search | github.com/mixer',
        sender: 'assistant',
      },
    ];

    const { container } = render(<ChatMessageList messages={messages} />);

    // Assert table element is rendered
    const table = container.querySelector('table');
    expect(table).toBeTruthy();

    // Assert headers are rendered
    const headers = container.querySelectorAll('th');
    expect(headers.length).toBe(3);
    expect(headers[0].textContent).toBe('Plugin');
    expect(headers[1].textContent).toBe('AI Features');
    expect(headers[2].textContent).toBe('Source');

    // Assert cells are rendered
    const cells = container.querySelectorAll('td');
    expect(cells.length).toBe(6);
    expect(cells[0].textContent).toBe('Logseq AI');
    expect(cells[1].textContent).toBe('Chat with graph');
    expect(cells[2].textContent).toBe('github.com/example');
    expect(cells[3].textContent).toBe('Mixer');
    expect(cells[4].textContent).toBe('RAG search');
    expect(cells[5].textContent).toBe('github.com/mixer');
  });
});

