import React from 'react';
import ReactMarkdown from 'react-markdown';
import { transformToMarkdownLinks as transformBlockRefs } from '../blockRefParser';
import { transformToMarkdownLinks as transformPageLinks } from '../pageLinkParser';
import { keyframes, styled } from '../stitches.config';
import { BlockLink } from './BlockLink';
import { CtrlLink } from './CtrlLink';
import { PageLink } from './PageLink';
import { ChangeSummary } from './ChangeSummary';
import MermaidChart from './MermaidChart';
import InlineSVG from './InlineSVG';
import type { ExecutionResult } from '../types/editTypes';

export type ChatMessage = {
  id: string | number;
  content: string;
  sender: 'user' | 'assistant';
  image?: { name: string; content: string }[];
  file?: { name: string; content: string }[];
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

const SpecialPanel = styled('div', {
  border: '1px solid $slate6',
  borderRadius: '8px',
  margin: '12px 0',
  overflow: 'hidden',
  backgroundColor: '$slate1',
});

const PanelHeader = styled('div', {
  display: 'flex',
  gap: '4px',
  backgroundColor: '$slate3',
  padding: '6px 8px',
  borderBottom: '1px solid $slate6',
});

const PanelTabButton = styled('button', {
  background: 'none',
  border: 'none',
  padding: '4px 10px',
  fontSize: '12px',
  fontWeight: '600',
  borderRadius: '4px',
  cursor: 'pointer',
  transition: 'all 0.15s ease-in-out',
  fontFamily: '$sans',
  color: '$slate9',

  '&:hover': {
    color: '$slate12',
    backgroundColor: '$slate5',
  },

  variants: {
    active: {
      true: {
        color: '$slate12',
        backgroundColor: '$slate6',
      },
    },
  },
});

const TabPanel = styled('div', {
  variants: {
    active: {
      true: {
        display: 'block',
      },
      false: {
        display: 'none',
      },
    },
  },
});

const CodeArea = styled('div', {
  margin: 0,
  padding: '12px',
  fontSize: '13px',
  fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
  backgroundColor: '$slate2',
  color: '$slate12',
  overflow: 'auto',
});

const CopyIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const CheckIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const CopyButton = styled('button', {
  background: 'none',
  border: 'none',
  padding: '4px 8px',
  fontSize: '12px',
  fontWeight: '500',
  borderRadius: '4px',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  color: '$slate9',
  marginLeft: 'auto',
  transition: 'all 0.15s ease-in-out',
  fontFamily: '$sans',

  '&:hover': {
    color: '$slate12',
    backgroundColor: '$slate5',
  },
  '&:active': {
    transform: 'scale(0.95)',
  },
  variants: {
    copied: {
      true: {
        color: '$green11',
        '&:hover': {
          color: '$green11',
          backgroundColor: '$green3',
        },
      },
    },
  },
});

const PreviewArea = styled('div', {
  padding: '12px',
  fontSize: '14px',
  lineHeight: 1.6,
  backgroundColor: '$slate1',
  color: '$slate12',
  // Preview markdown content styling
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
});

const PropertyBlock = styled('div', {
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
  padding: '8px 12px',
  marginBottom: '10px',
  borderRadius: '6px',
  border: '1px solid $slate6',
  backgroundColor: '$slate3',
  fontSize: '12px',
});

const PropertyRow = styled('div', {
  display: 'flex',
  gap: '12px',
});

const PropertyKey = styled('span', {
  fontWeight: '600',
  color: '$slate11',
  minWidth: '90px',
  userSelect: 'none',
});

const PropertyValue = styled('span', {
  color: '$slate12',
});

const TaskBadge = styled('span', {
  display: 'inline-block',
  padding: '2px 6px',
  fontSize: '11px',
  fontWeight: '700',
  borderRadius: '3px',
  marginRight: '6px',
  textTransform: 'uppercase',
  fontFamily: '$sans',
  userSelect: 'none',
  lineHeight: '1.2',
  verticalAlign: 'middle',

  variants: {
    type: {
      TODO: {
        backgroundColor: '$red4',
        color: '$red11',
        border: '1px solid $red7',
      },
      LATER: {
        backgroundColor: '$red4',
        color: '$red11',
        border: '1px solid $red7',
      },
      DOING: {
        backgroundColor: '$blue4',
        color: '$blue11',
        border: '1px solid $blue7',
      },
      NOW: {
        backgroundColor: '$blue4',
        color: '$blue11',
        border: '1px solid $blue7',
      },
      DONE: {
        backgroundColor: '$green4',
        color: '$green11',
        border: '1px solid $green7',
      },
      WAITING: {
        backgroundColor: '$amber4',
        color: '$amber11',
        border: '1px solid $amber7',
      },
      CANCELLED: {
        backgroundColor: '$slate4',
        color: '$slate11',
        border: '1px solid $slate7',
      },
    },
  },
});

const StyledTable = styled('table', {
  width: '100%',
  borderCollapse: 'collapse',
  margin: '12px 0',
  fontSize: '13px',
  lineHeight: '1.5',
  border: '1px solid $slate6',
  borderRadius: '6px',
  overflow: 'hidden',
});

const TableHeaderCell = styled('th', {
  backgroundColor: '$slate4',
  color: '$slate12',
  fontWeight: '600',
  padding: '8px 10px',
  textAlign: 'left',
  borderBottom: '2px solid $slate6',
  borderRight: '1px solid $slate5',
  '&:last-child': {
    borderRight: 'none',
  },
});

const TableRow = styled('tr', {
  backgroundColor: '$slate1',
  '&:nth-child(even)': {
    backgroundColor: '$slate3',
  },
  '&:hover': {
    backgroundColor: '$slate4',
  },
});

const TableCell = styled('td', {
  padding: '8px 10px',
  color: '$slate12',
  borderBottom: '1px solid $slate5',
  borderRight: '1px solid $slate5',
  '&:last-child': {
    borderRight: 'none',
  },
});

type ChatMessageListProps = {
  messages: ChatMessage[];
  editResults?: Map<string | number, ExecutionResult>;
  getBlockMetadata?: (uuid: string) => { pageName: string; contentPreview: string } | null;
  onFileReattach?: (file: { name: string; content: string }) => void;
  onImageReattach?: (image: { name: string; content: string }) => void;
};

export function parseProperties(text: string): { properties: Record<string, string>; content: string } {
  const lines = text.split('\n');
  const properties: Record<string, string> = {};
  const contentLines: string[] = [];
  let readingProperties = true;

  for (const line of lines) {
    const trimmed = line.trim();
    if (readingProperties && trimmed.includes('::')) {
      const parts = trimmed.split('::');
      const key = parts[0].trim();
      const val = parts.slice(1).join('::').trim();
      if (key && /^[a-zA-Z0-9-_]+$/.test(key)) {
        properties[key] = val;
        continue;
      }
    }
    if (trimmed !== '') {
      readingProperties = false;
    }
    contentLines.push(line);
  }

  return { properties, content: contentLines.join('\n') };
}

export function transformTags(input: string): string {
  let transformed = input.replace(/#\[\[([^\]]+)\]\]/g, (_match, name) => {
    return `[#${name}](logseq://page/${encodeURIComponent(name)})`;
  });
  transformed = transformed.replace(/(?<![a-zA-Z0-9-_\[/])#([a-zA-Z0-9-_]+)/g, (_match, name) => {
    return `[#${name}](logseq://page/${encodeURIComponent(name)})`;
  });
  return transformed;
}

export function transformTaskMarkers(input: string): string {
  const markers = ['TODO', 'DOING', 'DONE', 'LATER', 'NOW', 'WAITING', 'CANCELLED'];
  let transformed = input;
  for (const marker of markers) {
    const regex = new RegExp(`(^|\\n|-\\s+|\\*\\s+|\\d+\\.\\s+)(${marker})\\b`, 'g');
    transformed = transformed.replaceAll(regex, (match, prefix, m) => {
      return `${prefix}[${m}](logseq://task/${m})`;
    });
  }
  return transformed;
}

export function transformCheckboxes(input: string): string {
  let transformed = input.replaceAll(/\[ \]/g, '[ ](logseq://checkbox/unchecked)');
  transformed = transformed.replaceAll(/\[x\]/gi, '[x](logseq://checkbox/checked)');
  return transformed;
}

const processMarkdownContent = (text: string) => {
  let processed = text;
  processed = transformTaskMarkers(processed);
  processed = transformCheckboxes(processed);
  processed = transformTags(processed);
  processed = transformBlockRefs(processed);
  processed = transformPageLinks(processed);
  return processed;
};

export type ContentPart =
  | { type: 'markdown'; content: string }
  | { type: 'table'; headers: string[]; rows: string[][]; rawContent: string };

export function parseContentWithTables(input: string): ContentPart[] {
  const lines = input.split('\n');
  const parts: ContentPart[] = [];
  let currentMarkdownLines: string[] = [];
  let currentTableLines: string[] = [];
  let inCodeBlock = false;

  const flushMarkdown = () => {
    if (currentMarkdownLines.length > 0) {
      parts.push({
        type: 'markdown',
        content: currentMarkdownLines.join('\n'),
      });
      currentMarkdownLines = [];
    }
  };

  const flushTable = () => {
    if (currentTableLines.length >= 2) {
      const headerLine = currentTableLines[0];
      const rowsLines = currentTableLines.slice(2);
      const rawContent = currentTableLines.join('\n');

      const splitRow = (line: string) => {
        const cells = line.split('|').map(c => c.trim());
        if (cells[0] === '') cells.shift();
        if (cells[cells.length - 1] === '') cells.pop();
        return cells;
      };

      const headers = splitRow(headerLine);
      const rows = rowsLines.map(splitRow);

      parts.push({
        type: 'table',
        headers,
        rows,
        rawContent,
      });
      currentTableLines = [];
    } else if (currentTableLines.length > 0) {
      // Not enough lines for a table, treat as regular markdown
      currentMarkdownLines.push(...currentTableLines);
      currentTableLines = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    // Toggle code block state if we see a fence
    const isFence = /^\s*(?:[-*+]\s+|\d+\.\s+)?(`{3,}|~{3,})/.test(line);
    if (isFence) {
      inCodeBlock = !inCodeBlock;
    }

    // Detect table lines: either has leading/trailing pipes, or has interior pipes
    // and is part of a table context (separator row confirms table)
    const hasPipes = !inCodeBlock && trimmed.includes('|');
    const isClassicTableLine = hasPipes && trimmed.startsWith('|') && trimmed.endsWith('|');
    const isSeparatorRow = hasPipes && /^[\s|:-]+$/.test(trimmed) && /---/.test(trimmed);

    if (isClassicTableLine) {
      flushMarkdown();
      currentTableLines.push(line);
    } else if (hasPipes && currentTableLines.length > 0) {
      // Already collecting table lines — continue collecting
      currentTableLines.push(line);
    } else if (hasPipes && currentTableLines.length === 0) {
      // Potential table header without leading/trailing pipes — look ahead for separator
      const nextLine = i + 1 < lines.length ? lines[i + 1].trim() : '';
      const nextIsSeparator = nextLine.includes('|') && /^[\s|:-]+$/.test(nextLine) && /---/.test(nextLine);
      if (nextIsSeparator) {
        flushMarkdown();
        currentTableLines.push(line);
      } else {
        flushTable();
        currentMarkdownLines.push(line);
      }
    } else {
      flushTable();
      currentMarkdownLines.push(line);
    }
  }

  flushMarkdown();
  flushTable();

  return parts;
}

const getMarkdownComponents = (
  shouldTransform: boolean,
  getBlockMetadata?: ChatMessageListProps['getBlockMetadata']
) => ({
  a: ({ href, children, ...props }: any) => {
    if (href?.startsWith('logseq://task/')) {
      const taskType = href.replace('logseq://task/', '');
      return <TaskBadge type={taskType as any}>{taskType}</TaskBadge>;
    }
    if (href?.startsWith('logseq://checkbox/')) {
      const checked = href.includes('checked') && !href.includes('unchecked');
      return (
        <input
          type="checkbox"
          checked={checked}
          readOnly
          style={{ marginRight: '6px', verticalAlign: 'middle', cursor: 'default' }}
        />
      );
    }
    if (href?.startsWith('logseq://page/')) {
      const pageName = decodeURIComponent(href.replace('logseq://page/', ''));
      return <PageLink pageName={pageName}>{children}</PageLink>;
    }
    if (href?.startsWith('logseq://block/')) {
      const uuid = href.replace('logseq://block/', '');
      const metadata = getBlockMetadata?.(uuid) ?? null;
      return (
        <BlockLink
          blockUuid={uuid}
          label={metadata?.contentPreview}
          pageName={metadata?.pageName}
        >
          {children}
        </BlockLink>
      );
    }
    return <CtrlLink href={href} {...props}>{children}</CtrlLink>;
  },
  code: ({ node, inline, className, children, ...props }: any) => {
    if (inline) {
      return <code className={className} {...props}>{children}</code>;
    }

    const match = /language-(\w+)/.exec(className || '');
    const language = match ? match[1] : '';
    const codeContent = String(children).replace(/\n$/, '');
    const isMarkdown = language === 'markdown' || language === 'md';
    const isMermaid = language === 'mermaid';
    const isSVG = language === 'svg' || (language === 'html' && codeContent.trim().startsWith('<svg'));

    if (isMermaid) {
      return <MermaidChart code={codeContent} />;
    }

    if (isSVG || (!language && codeContent.trim().startsWith('<svg'))) {
      return <InlineSVG content={codeContent} />;
    }

    if (shouldTransform && isMarkdown) {
      return (
        <MarkdownTabbedPanel
          content={codeContent}
          getBlockMetadata={getBlockMetadata}
        />
      );
    }

    return (
      <pre className={className}>
        <code className={className} {...props}>
          {children}
        </code>
      </pre>
    );
  },
  img: ({ src, alt, ...props }: any) => {
    const handleCopyImage = async () => {
      try {
        const res = await fetch(src);
        const blob = await res.blob();
        const pngBlob = blob.type === 'image/png' ? blob
          : await new Promise<Blob>((resolve) => {
              const img = new Image();
              img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                canvas.getContext('2d')!.drawImage(img, 0, 0);
                canvas.toBlob((b) => resolve(b!), 'image/png');
              };
              img.src = src;
            });
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
        const btn = document.activeElement as HTMLElement;
        if (btn) { btn.textContent = '✓ Copied!'; setTimeout(() => { btn.textContent = '📋 Copy Image'; }, 1500); }
      } catch (err) {
        console.error('Failed to copy image:', err);
      }
    };
    return (
      <span style={{ display: 'inline-block', position: 'relative' }}>
        <img
          src={src}
          alt={alt || ''}
          {...props}
          style={{ maxWidth: '100%', borderRadius: 6, display: 'block' }}
          onError={(e) => { (e.target as HTMLImageElement).parentElement!.style.display = 'none'; }}
        />
        <button
          onClick={handleCopyImage}
          style={{ position: 'absolute', top: 4, right: 4, fontSize: 11, padding: '2px 6px', borderRadius: 4, border: '1px solid rgba(0,0,0,0.2)', background: 'rgba(255,255,255,0.9)', cursor: 'pointer' }}
        >📋 Copy Image</button>
      </span>
    );
  }
});

const renderMarkdownWithProperties = (
  rawText: string,
  shouldTransform: boolean,
  getBlockMetadata?: ChatMessageListProps['getBlockMetadata'],
  wrapTables: boolean = false
) => {
  const { properties, content } = parseProperties(rawText);
  let processedContent = content;

  if (shouldTransform) {
    processedContent = processMarkdownContent(content);
  }

  const parts = parseContentWithTables(processedContent);
  const hasProperties = Object.keys(properties).length > 0;
  const components = getMarkdownComponents(shouldTransform, getBlockMetadata);

  return (
    <>
      {hasProperties && (
        <PropertyBlock>
          {Object.entries(properties).map(([key, val]) => (
            <PropertyRow key={key}>
              <PropertyKey>{key}:</PropertyKey>
              <PropertyValue>{val}</PropertyValue>
            </PropertyRow>
          ))}
        </PropertyBlock>
      )}
      {parts.map((part, index) => {
        if (part.type === 'table') {
          if (wrapTables) {
            return (
              <MarkdownTabbedPanel
                key={index}
                content={part.rawContent}
                getBlockMetadata={getBlockMetadata}
              />
            );
          }

          return (
            <StyledTable key={index}>
              <thead>
                <tr>
                  {part.headers.map((header, hIndex) => (
                    <TableHeaderCell key={hIndex}>
                      <ReactMarkdown
                        transformLinkUri={(uri: string) => uri}
                        components={components as any}
                      >
                        {header}
                      </ReactMarkdown>
                    </TableHeaderCell>
                  ))}
                </tr>
              </thead>
              <tbody>
                {part.rows.map((row, rIndex) => (
                  <TableRow key={rIndex}>
                    {row.map((cell, cIndex) => (
                      <TableCell key={cIndex}>
                        <ReactMarkdown
                          transformLinkUri={(uri: string) => uri}
                          components={components as any}
                        >
                          {cell}
                        </ReactMarkdown>
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </tbody>
            </StyledTable>
          );
        }

        // Detect inline SVG in content and render separately
        if (part.content.includes('<svg')) {
          const svgRegex = /(<svg[\s\S]*?<\/svg>)/gi;
          const segments = part.content.split(svgRegex);
          return (
            <React.Fragment key={index}>
              {segments.map((seg, i) =>
                seg.trim().toLowerCase().startsWith('<svg')
                  ? <InlineSVG key={i} content={seg} />
                  : seg.trim() ? (
                    <ReactMarkdown
                      key={i}
                      transformLinkUri={(uri: string) => uri}
                      components={components as any}
                    >
                      {seg}
                    </ReactMarkdown>
                  ) : null
              )}
            </React.Fragment>
          );
        }

        return (
          <ReactMarkdown
            key={index}
            transformLinkUri={(uri: string) => uri}
            components={components as any}
          >
            {part.content}
          </ReactMarkdown>
        );
      })}
    </>
  );
};

function MarkdownTabbedPanel({
  content,
  getBlockMetadata,
}: {
  content: string;
  getBlockMetadata?: ChatMessageListProps['getBlockMetadata'];
}) {
  const [activeTab, setActiveTab] = React.useState<'code' | 'preview'>('code');
  const [copied, setCopied] = React.useState(false);
  const previewRef = React.useRef<HTMLDivElement>(null);

  const handleCopy = async () => {
    try {
      if (activeTab === 'code') {
        await navigator.clipboard.writeText(content);
      } else if (activeTab === 'preview' && previewRef.current) {
        const text = previewRef.current.innerText || previewRef.current.textContent || '';
        const html = previewRef.current.innerHTML || '';

        if (typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard.write === 'function') {
          const textBlob = new Blob([text], { type: 'text/plain' });
          const htmlBlob = new Blob([html], { type: 'text/html' });
          const item = new ClipboardItem({
            'text/plain': textBlob,
            'text/html': htmlBlob,
          });
          await navigator.clipboard.write([item]);
        } else {
          await navigator.clipboard.writeText(text);
        }
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text:', err);
    }
  };

  const handleTabChange = (tab: 'code' | 'preview') => {
    setActiveTab(tab);
    setCopied(false);
  };

  return (
    <SpecialPanel>
      <PanelHeader>
        <PanelTabButton
          active={activeTab === 'code'}
          data-active={activeTab === 'code'}
          onClick={() => handleTabChange('code')}
        >
          Code
        </PanelTabButton>
        <PanelTabButton
          active={activeTab === 'preview'}
          data-active={activeTab === 'preview'}
          onClick={() => handleTabChange('preview')}
        >
          Preview
        </PanelTabButton>
        <CopyButton
          copied={copied}
          onClick={handleCopy}
          title={copied ? 'Copied!' : activeTab === 'code' ? 'Copy code' : 'Copy preview'}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
          {copied ? 'Copied' : 'Copy'}
        </CopyButton>
      </PanelHeader>

      <TabPanel active={activeTab === 'code'}>
        <CodeArea>{content}</CodeArea>
      </TabPanel>

      <TabPanel active={activeTab === 'preview'}>
        <PreviewArea ref={previewRef}>
          {renderMarkdownWithProperties(content, true, getBlockMetadata, false)}
        </PreviewArea>
      </TabPanel>
    </SpecialPanel>
  );
}

export default function ChatMessageList({ messages, editResults, getBlockMetadata, onFileReattach, onImageReattach }: ChatMessageListProps) {
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
      {messages.map((msg) => {
        const result = editResults?.get(msg.id);
        return (
          <React.Fragment key={msg.id}>
            <MessageRow align={msg.sender}>
              {msg.sender === 'assistant' && <Avatar role="assistant">AI</Avatar>}
              <Bubble role={msg.sender}>
                {msg.image && msg.image.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 6 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {msg.image.map((img, imgIdx) => (
                        <span key={imgIdx} style={{ display: 'inline-block', position: 'relative' }}>
                          <img src={img.content} alt={img.name} style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 6, display: 'block' }} />
                        </span>
                      ))}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {msg.image.map((img, i) => (
                        <span
                          key={i}
                          onClick={() => onImageReattach?.(img)}
                          style={{ display: 'inline-block', padding: '2px 8px', fontSize: 12, borderRadius: 4, background: 'rgba(0,0,0,0.05)', cursor: 'pointer' }}
                          title="Click to re-attach this image"
                        >📷 {img.name}</span>
                      ))}
                    </div>
                  </div>
                )}
                {msg.file && msg.file.length > 0 && (
                  <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 4 }}>
                    {msg.file.map((f, i) => (
                      <span
                        key={i}
                        onClick={() => onFileReattach?.(f)}
                        style={{ display: 'inline-block', padding: '2px 8px', fontSize: 12, borderRadius: 4, background: 'rgba(0,0,0,0.05)', cursor: 'pointer' }}
                        title="Click to re-attach this file"
                      >📎 {f.name}</span>
                    ))}
                  </span>
                )}
                {renderMarkdownWithProperties(
                  msg.content,
                  msg.sender === 'assistant',
                  getBlockMetadata,
                  msg.sender === 'assistant'
                )}
              </Bubble>
              {msg.sender === 'user' && <Avatar role="user">U</Avatar>}
            </MessageRow>
            {result && (
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-start', marginTop: '4px', marginBottom: '12px' }}>
                <div style={{ width: '28px', flexShrink: 0 }} />
                <div style={{ maxWidth: '80%', width: '100%' }}>
                  <ChangeSummary result={result} />
                </div>
              </div>
            )}
          </React.Fragment>
        );
      })}
    </Container>
  );
}

