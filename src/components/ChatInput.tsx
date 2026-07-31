import React, { useRef } from 'react';
import { styled } from '../stitches.config';
import { AutoEmbedToggle } from './AutoEmbedToggle';
import { EditToggle } from './EditToggle';
import { AgentToggle } from './AgentToggle';
import { VerboseToggle } from './VerboseToggle';

// --- Styled Components ---

const InputArea = styled('div', {
  padding: '12px 16px 16px',
  borderTop: '1px solid $slate6',
  backgroundColor: '$elevation0',
});

const InputWrapper = styled('div', {
  display: 'flex',
  flexDirection: 'column',
  border: '1px solid $slate7',
  borderRadius: '10px',
  padding: '8px',
  backgroundColor: '$elevation1',
  transition: 'border-color 0.15s, box-shadow 0.15s',
  '&:focus-within': { borderColor: '$blue8', boxShadow: '0 0 0 2px $colors$blue4' },
});

const InputButtonRow = styled('div', {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginTop: '4px',
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

const ImageButton = styled('button', {
  width: '28px',
  height: '28px',
  borderRadius: '6px',
  border: 'none',
  backgroundColor: 'transparent',
  color: '$gray11',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  '&:hover:not(:disabled)': { backgroundColor: '$gray4' },
  '&:disabled': { opacity: 0.4, cursor: 'default' },
});

const ToolbarRow = styled('div', {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '6px',
  marginTop: '8px',
  flexWrap: 'wrap',
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

// --- Props ---

interface ChatInputProps {
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  inputMessage: string;
  loading: boolean;
  imageDataUrls: { name: string; content: string }[];
  attachedFiles: { name: string; content: string }[];
  inputHistory: string[];
  onInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onPaste: (e: React.ClipboardEvent) => void;
  onSubmit: () => void;
  onCancel: () => void;
  onFile: (file: File) => void;
  onRemoveImage: (index: number) => void;
  onRemoveFile: (index: number) => void;
  onClearHistory: () => void;
  autoEmbedEnabled: boolean;
  onAutoEmbedToggle: () => void;
  aiEditMode: boolean;
  onEditToggle: () => void;
  agentModeOn: boolean;
  onAgentModeToggle: () => void;
  verboseMode: boolean;
  onVerboseToggle: () => void;
  onOpenDbPanel: () => void;
  onOpenMcpPanel: () => void;
  onOpenMemoryPanel: () => void;
  onOpenSkillPanel: () => void;
  memoryCount: number;
  skillCount: number;
  isSummarizing: boolean;
  indexButtonProps: { variant?: string; label: string; disabled: boolean };
  onIndex: () => void;
  isIndexing: boolean;
  progressCount: number;
  indexingStatus: any;
  isDismissing: boolean;
  docCount: number | null;
  pageCount: number | null;
  activePageName: string | null;
  activeBlockContent: string | null;
}

// --- Component ---

export function ChatInput(props: ChatInputProps) {
  const {
    textareaRef, inputMessage, loading,
    imageDataUrls, attachedFiles, inputHistory,
    onInputChange, onKeyDown, onPaste, onSubmit, onCancel,
    onFile, onRemoveImage, onRemoveFile, onClearHistory,
    autoEmbedEnabled, onAutoEmbedToggle,
    aiEditMode, onEditToggle,
    agentModeOn, onAgentModeToggle,
    verboseMode, onVerboseToggle,
    onOpenDbPanel, onOpenMcpPanel, onOpenMemoryPanel, onOpenSkillPanel,
    memoryCount, skillCount, isSummarizing,
    indexButtonProps, onIndex,
    isIndexing, progressCount, indexingStatus, isDismissing,
    docCount, pageCount, activePageName, activeBlockContent,
  } = props;

  const imageFileRef = useRef<HTMLInputElement | null>(null);

  return (
    <InputArea>
      {imageDataUrls.length > 0 && (
        <div style={{ padding: '4px 8px', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          {imageDataUrls.map((img, i) => (
            <span key={i} style={{ position: 'relative', display: 'inline-block' }}>
              <img src={img.content} alt={img.name} style={{ maxHeight: 48, maxWidth: 80, borderRadius: 4 }} />
              <button onClick={() => onRemoveImage(i)} style={{ position: 'absolute', top: -4, right: -4, background: 'rgba(0,0,0,0.6)', color: 'white', border: 'none', borderRadius: '50%', width: 16, height: 16, fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>&#x2715;</button>
            </span>
          ))}
        </div>
      )}
      {attachedFiles.length > 0 && (
        <div style={{ padding: '4px 8px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px', fontSize: 12 }}>
          {attachedFiles.map((f, i) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: '2px', background: 'rgba(0,0,0,0.05)', borderRadius: 4, padding: '1px 6px' }}>
              &#x1F4CE; {f.name}
              <button onClick={() => onRemoveFile(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, padding: 0 }}>&#x2715;</button>
            </span>
          ))}
        </div>
      )}
      <InputWrapper>
        <input
          ref={imageFileRef}
          type="file"
          accept="*/*"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => { if (e.target.files) { Array.from(e.target.files).forEach(onFile); } e.target.value = ''; }}
        />
        <TextArea
          ref={textareaRef}
          placeholder={loading ? 'Thinking...' : 'Ask about your notes...'}
          value={inputMessage}
          onChange={onInputChange}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          disabled={loading}
          rows={4}
        />
        <InputButtonRow>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <ImageButton onClick={() => imageFileRef.current?.click()} aria-label="Attach file" title="Attach file" disabled={loading}>
              <svg viewBox="0 0 24 24" width="18" height="18"><path d="M16.5 6v11.5a4 4 0 0 1-8 0V5a2.5 2.5 0 0 1 5 0v10.5a1 1 0 0 1-2 0V6h-1v9.5a2 2 0 0 0 4 0V5a3.5 3.5 0 0 0-7 0v12.5a5 5 0 0 0 10 0V6h-1z" fill="currentColor"/></svg>
            </ImageButton>
            {inputHistory.length > 0 && (
              <ImageButton
                onClick={onClearHistory}
                aria-label="Clear input history"
                title={`Clear input history (${inputHistory.length} entries)`}
                disabled={loading}
                css={{ width: '22px', height: '22px', opacity: 0.5, '&:hover:not(:disabled)': { opacity: 1, backgroundColor: '$red4', color: '$red11' } }}
              >
                <svg viewBox="0 0 24 24" width="14" height="14"><path d="M3 6h18M8 6V4h8v2M5 6v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6M10 11v6M14 11v6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </ImageButton>
            )}
          </div>
          {loading ? (
            <SendButton onClick={onCancel} aria-label="Cancel" title="Cancel" css={{ backgroundColor: '$red9', '&:hover:not(:disabled)': { backgroundColor: '$red10' } }}>
              <svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
            </SendButton>
          ) : (
            <SendButton onClick={onSubmit} disabled={!inputMessage.trim()} aria-label="Send" title="Send">
              <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" /></svg>
            </SendButton>
          )}
        </InputButtonRow>
      </InputWrapper>
      <ToolbarRow>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <AutoEmbedToggle enabled={autoEmbedEnabled} onToggle={onAutoEmbedToggle} />
          <EditToggle enabled={aiEditMode} onToggle={onEditToggle} />
          <AgentToggle enabled={agentModeOn} onToggle={onAgentModeToggle} />
          <VerboseToggle enabled={verboseMode} onToggle={onVerboseToggle} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <ToolbarButton onClick={onOpenDbPanel} title="Database">&#x1F5C4;&#xFE0F;</ToolbarButton>
          <ToolbarButton onClick={onOpenMcpPanel} title="MCP Servers">&#x1F50C;</ToolbarButton>
          <ToolbarButton onClick={onOpenMemoryPanel} title="Memory">
            &#x1F9E0;{memoryCount > 0 && <span style={{ fontSize: '10px', opacity: 0.7 }}>{memoryCount}</span>}{isSummarizing && <span style={{ marginLeft: '2px' }}>&#x23F3;</span>}
          </ToolbarButton>
          <ToolbarButton onClick={onOpenSkillPanel} title="Skills">
            &#x1F9E9;{skillCount > 0 && <span style={{ fontSize: '10px', opacity: 0.7 }}>{skillCount}</span>}
          </ToolbarButton>
          <ToolbarButton
            variant={indexButtonProps.variant as any}
            onClick={onIndex}
            disabled={indexButtonProps.disabled}
            title="Re-Index"
            css={indexButtonProps.disabled ? { opacity: 0.5, cursor: 'default' } : undefined}
          >
            {indexButtonProps.label}
          </ToolbarButton>
        </div>
      </ToolbarRow>
      <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2, paddingLeft: 2 }}>
        {isIndexing ? (
          <span>Indexing&hellip; {progressCount} pages processed</span>
        ) : indexingStatus?.outcome === 'completed' ? (
          <span style={isDismissing ? { opacity: 0 } : undefined}>&checkmark; Indexing complete &middot; {docCount?.toLocaleString()} chunks{pageCount ? ` \u00B7 ${pageCount.toLocaleString()} pages` : ''}</span>
        ) : indexingStatus?.outcome === 'paused' ? (
          <span>&#x23F8; Indexing paused</span>
        ) : docCount !== null ? (
          <span>&#x1F4CA; {docCount.toLocaleString()} chunks{pageCount ? ` \u00B7 ${pageCount.toLocaleString()} pages` : ''}</span>
        ) : null}
      </div>
      <div style={{ fontSize: 11, color: activePageName ? '#6b7280' : '#f59e0b', marginTop: 4, paddingLeft: 2 }}>
        {activePageName ? `\u{1F4C4} ${activePageName}` : '\u26A0 No active page'}
        {activeBlockContent && <span style={{ color: '#9ca3af', marginLeft: '8px' }}>{'\u25B8'} {activeBlockContent}{activeBlockContent.length >= 50 ? '\u2026' : ''}</span>}
      </div>
    </InputArea>
  );
}

export default ChatInput;
