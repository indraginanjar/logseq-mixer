import React from 'react';
import ReactMarkdown from 'react-markdown';
import { transformToMarkdownLinks as transformBlockRefs, transformBlockAnnotations } from '../blockRefParser';
import { transformToMarkdownLinks as transformPageLinks } from '../pageLinkParser';
import { wrapCliInCodeBlocks } from '../utils/cliCodeBlockDetector';
import { detectCsvBlocks, mightContainCsv } from '../utils/csvDetector';
import type { CsvTable } from '../utils/csvDetector';
import {
  parseProperties,
  transformTags,
  transformTaskMarkers,
  transformCheckboxes,
  transformBareUrls,
  parseContentWithTables,
} from '../utils/markdownTransforms';
import type { ContentPart } from '../utils/markdownTransforms';
import { keyframes, styled } from '../stitches.config';
import { BlockLink } from './BlockLink';
import { CtrlLink } from './CtrlLink';
import { PageLink } from './PageLink';
import { ChangeSummary } from './ChangeSummary';
import MermaidChart from './MermaidChart';
import PlantUMLChart from './PlantUMLChart';
import InlineSVG from './InlineSVG';
import { MaximizeOverlay, maximizeButtonStyle } from './MaximizeOverlay';
import type { ExecutionResult } from '../types/editTypes';
import { UIChatMessage } from '../types/chatMessage';

/** @deprecated Use UIChatMessage from 'types/chatMessage' directly. Kept for backwards compatibility. */
export type ChatMessage = UIChatMessage;
export type { UIChatMessage };

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
  minWidth: 0,
  padding: '10px 14px',
  borderRadius: '12px',
  fontSize: '14px',
  lineHeight: 1.6,
  wordBreak: 'break-word',
  overflowWrap: 'break-word',
  overflow: 'hidden',
  // Markdown content styling
  '& p': { margin: '0 0 8px 0', '&:last-child': { marginBottom: 0 } },
  '& pre': {
    backgroundColor: '$slate3',
    borderRadius: '6px',
    padding: '10px 12px',
    overflow: 'auto',
    fontSize: '13px',
    margin: '8px 0',
    maxWidth: '100%',
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











const processMarkdownContent = (text: string) => {
  let processed = text;
  processed = transformTaskMarkers(processed);
  processed = transformCheckboxes(processed);
  processed = transformTags(processed);
  processed = transformBlockAnnotations(processed);
  processed = transformBlockRefs(processed);
  processed = transformPageLinks(processed);
  processed = transformBareUrls(processed);
  return processed;
};





function ImageWithMaximize({ src, alt, ...props }: any) {
  const [maximized, setMaximized] = React.useState(false);

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
        style={{ maxWidth: '100%', borderRadius: 6, display: 'block', cursor: 'pointer' }}
        onClick={() => setMaximized(true)}
        onError={(e) => { (e.target as HTMLImageElement).parentElement!.style.display = 'none'; }}
      />
      <button
        onClick={() => setMaximized(true)}
        style={maximizeButtonStyle}
        title="View fullscreen"
      >⛶</button>
      <button
        onClick={handleCopyImage}
        style={{ position: 'absolute', top: 4, right: 4, fontSize: 11, padding: '2px 6px', borderRadius: 4, border: '1px solid rgba(0,0,0,0.2)', background: 'rgba(255,255,255,0.9)', cursor: 'pointer' }}
      >📋 Copy</button>
      <MaximizeOverlay open={maximized} onClose={() => setMaximized(false)}>
        <img src={src} alt={alt || ''} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
      </MaximizeOverlay>
    </span>
  );
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
    const isPlantUML = language === 'plantuml' || language === 'puml';
    const isSVG = language === 'svg' || (language === 'html' && codeContent.trim().startsWith('<svg'));

    if (isMermaid) {
      return <MermaidTabbedPanel code={codeContent} />;
    }

    if (isPlantUML) {
      return <PlantUMLTabbedPanel code={codeContent} />;
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
    return <ImageWithMaximize src={src} alt={alt} {...props} />;
  }
});

const renderMarkdownWithProperties = (
  rawText: string,
  shouldTransform: boolean,
  getBlockMetadata?: ChatMessageListProps['getBlockMetadata'],
  wrapTables: boolean = false
) => {
  const { properties, content } = parseProperties(rawText);
  let processedContent = wrapCliInCodeBlocks(content);

  // Protect SVG blocks from markdown transforms (transforms destroy hex colors like #ff0000)
  const svgPlaceholders: Map<string, string> = new Map();
  processedContent = processedContent.replace(/(<svg[\s\S]*?<\/svg>)/gi, (match, _svg, offset) => {
    const key = `__SVG_PLACEHOLDER_${offset}__`;
    svgPlaceholders.set(key, match);
    return key;
  });

  if (shouldTransform) {
    processedContent = processMarkdownContent(processedContent);
  }

  // Restore SVG blocks after transforms
  for (const [key, svg] of svgPlaceholders) {
    processedContent = processedContent.replace(key, svg);
  }

  const hasProperties = Object.keys(properties).length > 0;
  const components = getMarkdownComponents(shouldTransform, getBlockMetadata);

  // Check for CSV content and split into segments
  const csvParts = mightContainCsv(processedContent) ? detectCsvBlocks(processedContent) : null;

  const renderMarkdownSegment = (text: string, key: number | string) => {
    const parts = parseContentWithTables(text);
    return (
      <React.Fragment key={key}>
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
      </React.Fragment>
    );
  };

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
      {csvParts ? (
        csvParts.map((part, index) => {
          if (part.type === 'csv') {
            return <CsvTabbedPanel key={index} table={part.table} />;
          }
          return renderMarkdownSegment(part.content, index);
        })
      ) : (
        renderMarkdownSegment(processedContent, 'main')
      )}
    </>
  );
};

const MermaidTabbedPanel = React.memo(function MermaidTabbedPanel({ code: initialCode }: { code: string }) {
  const [activeTab, setActiveTab] = React.useState<'preview' | 'code'>('code');
  const [copied, setCopied] = React.useState(false);
  const [renderRequested, setRenderRequested] = React.useState(false);
  const previewRef = React.useRef<HTMLDivElement>(null);
  const [currentCode, setCurrentCode] = React.useState(initialCode);

  // Update currentCode if the parent provides new code
  React.useEffect(() => { setCurrentCode(initialCode); }, [initialCode]);

  const handleCodeFixed = React.useCallback((fixedCode: string) => {
    setCurrentCode(fixedCode);
  }, []);

  const handleCopy = async () => {
    try {
      if (activeTab === 'code') {
        await navigator.clipboard.writeText(currentCode);
        setCopied(true);
      } else if (activeTab === 'preview') {
        // Copy the rendered chart as an image
        const svgEl = previewRef.current?.querySelector('svg');
        if (svgEl) {
          const bbox = svgEl.getBoundingClientRect();
          const width = bbox.width || svgEl.clientWidth || 400;
          const height = bbox.height || svgEl.clientHeight || 300;
          const svgData = new XMLSerializer().serializeToString(svgEl);
          const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
          const url = URL.createObjectURL(svgBlob);
          const img = new Image();
          img.onload = async () => {
            const canvas = document.createElement('canvas');
            const scale = 2;
            canvas.width = width * scale;
            canvas.height = height * scale;
            const ctx = canvas.getContext('2d')!;
            ctx.fillStyle = 'white';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.scale(scale, scale);
            ctx.drawImage(img, 0, 0, width, height);
            URL.revokeObjectURL(url);
            canvas.toBlob(async (blob) => {
              if (!blob) return;
              try {
                await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
                setCopied(true);
              } catch {
                await navigator.clipboard.writeText(svgData);
                setCopied(true);
              }
            }, 'image/png');
          };
          img.src = url;
        }
      }
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleTabChange = (tab: 'preview' | 'code') => {
    setActiveTab(tab);
    setCopied(false);
    if (tab === 'preview') {
      setRenderRequested(true);
    }
  };

  return (
    <SpecialPanel>
      <PanelHeader>
        <PanelTabButton
          active={activeTab === 'preview'}
          data-active={activeTab === 'preview'}
          onClick={() => handleTabChange('preview')}
        >
          Preview
        </PanelTabButton>
        <PanelTabButton
          active={activeTab === 'code'}
          data-active={activeTab === 'code'}
          onClick={() => handleTabChange('code')}
        >
          Code
        </PanelTabButton>
        <CopyButton
          copied={copied}
          onClick={handleCopy}
          title={copied ? 'Copied!' : activeTab === 'code' ? 'Copy mermaid code' : 'Copy chart as image'}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
          {copied ? 'Copied' : activeTab === 'code' ? 'Copy' : 'Copy Image'}
        </CopyButton>
      </PanelHeader>

      <TabPanel active={activeTab === 'preview'}>
        <div ref={previewRef}>
          {renderRequested ? (
            <MermaidChart code={currentCode} onCodeFixed={handleCodeFixed} />
          ) : (
            <div style={{ padding: '12px', fontSize: '12px', color: '#64748b' }}>
              Click "Preview" to render the chart
            </div>
          )}
        </div>
      </TabPanel>

      <TabPanel active={activeTab === 'code'}>
        <CodeArea>{currentCode}</CodeArea>
      </TabPanel>
    </SpecialPanel>
  );
});

const PlantUMLTabbedPanel = React.memo(function PlantUMLTabbedPanel({ code: initialCode }: { code: string }) {
  const [activeTab, setActiveTab] = React.useState<'preview' | 'code'>('preview');
  const [copied, setCopied] = React.useState(false);
  const [currentCode, setCurrentCode] = React.useState(initialCode);

  React.useEffect(() => { setCurrentCode(initialCode); }, [initialCode]);

  const handleCodeFixed = React.useCallback((fixedCode: string) => {
    setCurrentCode(fixedCode);
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(currentCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleTabChange = (tab: 'preview' | 'code') => {
    setActiveTab(tab);
    setCopied(false);
  };

  return (
    <SpecialPanel>
      <PanelHeader>
        <PanelTabButton
          active={activeTab === 'preview'}
          data-active={activeTab === 'preview'}
          onClick={() => handleTabChange('preview')}
        >
          Preview
        </PanelTabButton>
        <PanelTabButton
          active={activeTab === 'code'}
          data-active={activeTab === 'code'}
          onClick={() => handleTabChange('code')}
        >
          Code
        </PanelTabButton>
        <CopyButton
          copied={copied}
          onClick={handleCopy}
          title={copied ? 'Copied!' : 'Copy PlantUML code'}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
          {copied ? 'Copied' : 'Copy'}
        </CopyButton>
      </PanelHeader>

      <TabPanel active={activeTab === 'preview'}>
        <PlantUMLChart code={currentCode} onCodeFixed={handleCodeFixed} />
      </TabPanel>

      <TabPanel active={activeTab === 'code'}>
        <CodeArea>{currentCode}</CodeArea>
      </TabPanel>
    </SpecialPanel>
  );
});

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

function CsvTabbedPanel({ table }: { table: CsvTable }) {
  const [activeTab, setActiveTab] = React.useState<'code' | 'preview'>('preview');
  const [copied, setCopied] = React.useState(false);
  const previewRef = React.useRef<HTMLDivElement>(null);

  const handleCopy = async () => {
    try {
      if (activeTab === 'code') {
        await navigator.clipboard.writeText(table.rawContent);
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
      console.error('Failed to copy CSV:', err);
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
          title={copied ? 'Copied!' : activeTab === 'code' ? 'Copy CSV' : 'Copy table'}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
          {copied ? 'Copied' : 'Copy'}
        </CopyButton>
      </PanelHeader>

      <TabPanel active={activeTab === 'code'}>
        <CodeArea>{table.rawContent}</CodeArea>
      </TabPanel>

      <TabPanel active={activeTab === 'preview'}>
        <PreviewArea ref={previewRef}>
          <StyledTable>
            <thead>
              <tr>
                {table.headers.map((header, hIndex) => (
                  <TableHeaderCell key={hIndex}>{header}</TableHeaderCell>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, rIndex) => (
                <TableRow key={rIndex}>
                  {row.map((cell, cIndex) => (
                    <TableCell key={cIndex}>{cell}</TableCell>
                  ))}
                </TableRow>
              ))}
            </tbody>
          </StyledTable>
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
          <ChatMessageItem
            key={msg.id}
            msg={msg}
            result={result}
            getBlockMetadata={getBlockMetadata}
            onFileReattach={onFileReattach}
            onImageReattach={onImageReattach}
          />
        );
      })}
    </Container>
  );
}

const ChatMessageItem = React.memo(function ChatMessageItem({
  msg,
  result,
  getBlockMetadata,
  onFileReattach,
  onImageReattach,
}: {
  msg: ChatMessage;
  result?: ExecutionResult;
  getBlockMetadata?: ChatMessageListProps['getBlockMetadata'];
  onFileReattach?: ChatMessageListProps['onFileReattach'];
  onImageReattach?: ChatMessageListProps['onImageReattach'];
}) {
  // Build the header label: [timestamp role model]
  const roleLabel = msg.sender === 'assistant'
    ? `AI${msg.model ? ` ${msg.model}` : ''}`
    : 'U';
  const headerText = msg.timestamp
    ? `[${msg.timestamp} ${roleLabel}]`
    : `[${roleLabel}]`;

  return (
    <React.Fragment>
      <MessageRow align={msg.sender}>
        {msg.sender === 'user' && <div style={{ order: 1, width: '28px', flexShrink: 0 }} />}
        <div style={{
          maxWidth: '80%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: msg.sender === 'user' ? 'flex-end' : 'flex-start',
        }}>
          {/* Header line: styled for aesthetics, copies as plain bracket text */}
          <div style={{
            fontSize: '10px',
            color: msg.sender === 'assistant' ? '#8b5cf6' : '#6b7280',
            marginBottom: '3px',
            fontFamily: 'monospace',
            letterSpacing: '0.02em',
            opacity: 0.8,
            textAlign: msg.sender === 'user' ? 'right' : undefined,
          }}>
            {headerText}
          </div>
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
          {msg.sender === 'assistant' && msg.completedTimestamp && (
            <div style={{
              fontSize: '10px',
              color: '#8b5cf6',
              marginTop: '3px',
              fontFamily: 'monospace',
              letterSpacing: '0.02em',
              opacity: 0.7,
            }}>
              ✓ {msg.completedTimestamp}
              {msg.promptTokens != null && msg.completionTokens != null && (
                <span style={{ marginLeft: '8px', color: '#6b7280' }}>
                  ↑{msg.promptTokens.toLocaleString()} ↓{msg.completionTokens.toLocaleString()}
                </span>
              )}
            </div>
          )}
          {msg.sender === 'assistant' && !msg.completedTimestamp && msg.promptTokens != null && msg.completionTokens != null && (
            <div style={{
              fontSize: '10px',
              color: '#6b7280',
              marginTop: '3px',
              fontFamily: 'monospace',
              letterSpacing: '0.02em',
              opacity: 0.7,
            }}>
              ↑{msg.promptTokens.toLocaleString()} ↓{msg.completionTokens.toLocaleString()}
            </div>
          )}
        </div>
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
}, (prevProps, nextProps) => {
  // Only re-render when message content or result changes.
  // Ignore function prop reference changes (getBlockMetadata, onFileReattach, onImageReattach)
  return prevProps.msg === nextProps.msg && prevProps.result === nextProps.result;
});

