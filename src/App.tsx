import { AppUserConfigs } from '@logseq/libs/dist/LSPlugin';
import ChatMessageList from 'components/ChatMessageList';
import MCPServerPanel from 'components/MCPServerPanel';
import AgentPanel from './components/AgentPanel';
import MemoryPanel from './components/MemoryPanel';
import SkillPanel from './components/SkillPanel';
import TokenUsagePanel from './components/TokenUsagePanel';
import ChatHeader from './components/ChatHeader';
import ChatInput from './components/ChatInput';
import DatabasePanel from './components/DatabasePanel';
import { ensureBuiltinHelpSkill } from './skills/builtinHelpSkill';
import { loadAllSkills } from './skills/SkillStore';
import { MCPManager } from 'mcp/MCPManager';
import AgentProgress from './components/AgentProgress';
import { useThemeMode } from 'hooks/useThemeMode';
import React, { useEffect, useRef, useState } from 'react';
import { useRecoilState, useRecoilValue } from 'recoil';
import { getButtonState } from './buttonState';
import { MemoryWarning } from './components/MemoryIndicator';
import { useAppVisible } from './hooks/useAppVisible';
import { useCtrlKey } from './hooks/useCtrlKey';
import { usePanelResize } from './hooks/usePanelResize';
import { useModelSelection } from './hooks/useModelSelection';
import { useIndexing } from './hooks/useIndexing';
import { useAgentController } from './hooks/useAgentController';
import { useChatSession } from './hooks/useChatSession';
import { loadAgents, getActiveAgentId } from './agents/AgentConfigStore';
import { switchAgent } from './agents/agentSwitcher';
import { aiEditModeState, settingsState } from './state/settings';
import { darkTheme, keyframes, styled } from './stitches.config';
import type { StorageProvider } from './storage/StorageProvider';

// --- Animations ---

const slideIn = keyframes({
  '0%': { transform: 'translateX(100%)' },
  '100%': { transform: 'translateX(0)' },
});

const fadeIn = keyframes({
  '0%': { opacity: 0, transform: 'translateY(-4px)' },
  '100%': { opacity: 1, transform: 'translateY(0)' },
});

const fadeOut = keyframes({
  '0%': { opacity: 1, transform: 'translateY(0)' },
  '100%': { opacity: 0, transform: 'translateY(-4px)' },
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
  backgroundColor: '$elevation0',
  boxShadow: '-4px 0 24px rgba(0, 0, 0, 0.12)',
  display: 'flex',
  flexDirection: 'column',
  zIndex: 100,
  animation: `${slideIn} 0.25s ease-out`,
  borderLeft: '1px solid $slate6',
});

const MessagesContainer = styled('div', {
  flex: 1,
  overflowY: 'auto',
  padding: '16px',
  backgroundColor: '$elevation0',
  '&::-webkit-scrollbar': { width: '6px' },
  '&::-webkit-scrollbar-track': { background: 'transparent' },
  '&::-webkit-scrollbar-thumb': { background: '$slate6', borderRadius: '3px' },
  '& a.ctrl-link': {
    color: 'inherit',
    textDecoration: 'none',
    cursor: 'default',
  },
  '&.ctrl-held a.ctrl-link:hover': {
    textDecoration: 'underline',
    cursor: 'pointer',
  },
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

const StatusIndicator = styled('span', {
  fontSize: '11px',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  padding: '2px 8px',
  borderRadius: '6px',
  fontWeight: 500,

  '@motionSafe': {
    animation: `${fadeIn} 0.2s ease-out`,
  },

  variants: {
    variant: {
      success: {
        backgroundColor: '$green3',
        color: '$green11',
      },
      paused: {
        backgroundColor: '$amber3',
        color: '$amber11',
      },
      progress: {
        backgroundColor: 'transparent',
        color: '$slate9',
      },
    },
    dismissing: {
      true: {
        '@motionSafe': {
          animation: `${fadeOut} 0.2s ease-in forwards`,
        },
      },
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isVisible = useAppVisible();

  const { panelWidth, isResizingRef, handleResizeStart } = usePanelResize(panelRef as React.RefObject<HTMLDivElement>);
  const themeMode = useThemeMode(initialThemeMode);
  const ctrlHeld = useCtrlKey();
  const settings = useRecoilValue(settingsState);
  const [aiEditMode, setAiEditMode] = useRecoilState(aiEditModeState);

  const { modelChoices, currentModel, handleModelChange, handleEffortChange } = useModelSelection(settings);
  const indexing = useIndexing(storageProvider, settings, isVisible);
  const agentCtrl = useAgentController();
  const chatSession = useChatSession({ settings, storageProvider, aiEditMode, setAiEditMode: setAiEditMode as any, agentController: agentCtrl });

  // Destructure indexing hook
  const {
    isIndexing, indexingStatus, isDismissing, progressCount,
    autoEmbedEnabled, cooldownActive,
    docCount, setDocCount, pageCount, setPageCount, dbSize, setDbSize,
    confirmClearDb, setConfirmClearDb,
    handleIndexDB: handleIndexDBRaw, handleAutoEmbedToggle,
  } = indexing;

  // Destructure agent controller
  const {
    agentPlan, setAgentPlan,
    agentRunning, setAgentRunning,
    agentTokensUsed,
    escalationQuestion, setEscalationQuestion,
    agentLoopRef, escalationResolverRef,
    replanReason, setReplanReason, replanSteps, setReplanSteps, replanResolverRef,
    agentAbortRef,
    agentModeOn, verboseMode,
    handleAgentModeToggle, handleVerboseToggle,
  } = agentCtrl;

  // Destructure chat session
  const {
    messages,
    inputMessage, setInputMessage,
    loading, error, setError,
    editResults,
    thinkingText,
    imageDataUrls, setImageDataUrls,
    attachedFiles, setAttachedFiles,
    inputHistory, setInputHistory, historyIndex,
    isSummarizing,
    memoryCount, setMemoryCount,
    memoryStoreInstance,
    memoryStatus, handleTrimMessages,
    handleFile, handlePaste, handleInputChange,
    handleSubmit: handleSubmitRaw,
    handleCancel,
    handleKeyDown: handleKeyDownRaw,
    handleNewSession,
  } = chatSession;

  // Local UI state (not extracted to hooks)
  const [activePageName, setActivePageName] = useState<string | null>(null);
  const [activeBlockContent, setActiveBlockContent] = useState<string | null>(null);
  const [showDbPanel, setShowDbPanel] = useState(false);
  const [showMcpPanel, setShowMcpPanel] = useState(false);
  const [showMemoryPanel, setShowMemoryPanel] = useState(false);
  const [showSkillPanel, setShowSkillPanel] = useState(false);
  const [showTokenUsagePanel, setShowTokenUsagePanel] = useState(false);
  const [skillCount, setSkillCount] = useState(0);
  const [agents, setAgents] = useState(loadAgents());
  const [activeAgentId, setActiveAgentId] = useState(getActiveAgentId());
  const [showAgentPanel, setShowAgentPanel] = useState(false);

  // Wrappers for hook functions that need refs from this component
  const handleSubmit = () => handleSubmitRaw(textareaRef as React.RefObject<HTMLTextAreaElement>);
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => handleKeyDownRaw(e, handleSubmit);
  const handleIndexDB = async () => {
    const errMsg = await handleIndexDBRaw();
    if (errMsg) setError(errMsg);
  };

  const handleAgentSwitch = (agentId: string) => {
    try {
      const currentState = { history: [], messages: messages };
      switchAgent(currentState, agentId);
      setActiveAgentId(agentId);
      setAgents(loadAgents());
    } catch (err) {
      console.error('[App] Agent switch failed:', err);
    }
  };

  const handleOpenAgentPanel = () => {
    setShowDbPanel(false);
    setShowMcpPanel(false);
    setShowMemoryPanel(false);
    setShowSkillPanel(false);
    setShowTokenUsagePanel(false);
    setShowAgentPanel(prev => !prev);
  };

  // Initialize and lifecycle manage MCPManager
  useEffect(() => {
    const manager = MCPManager.getInstance();
    manager.initialize();
    const onSettingsChanged = () => {
      manager.syncWithSettings();
    };
    window.logseq.onSettingsChanged(onSettingsChanged);
    return () => {
      manager.shutdown();
    };
  }, []);

  // Initialize built-in skills on mount
  useEffect(() => {
    ensureBuiltinHelpSkill().then(() => {
      loadAllSkills().then(skills => {
        setSkillCount(skills.filter(s => s.enabled).length);
      }).catch(() => {});
    });
  }, []);

  // Track active page name
  useEffect(() => {
    const updatePage = async () => {
      try {
        let page = await logseq.Editor.getCurrentPage();
        const block = await logseq.Editor.getCurrentBlock();
        if (!page) {
          if (block?.page) page = await logseq.Editor.getPage(block.page.id);
        }
        setActivePageName(page?.name as string ?? null);
        setActiveBlockContent(block?.content?.trim()?.slice(0, 50) || null);
      } catch {
        setActivePageName(null);
        setActiveBlockContent(null);
      }
    };
    updatePage();
    const id = setInterval(updatePage, 3000);
    return () => clearInterval(id);
  }, []);

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading, agentPlan, agentTokensUsed]);

  const handleImportFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const buffer = event.target?.result as ArrayBuffer;
      if (buffer) {
        try {
          if (storageProvider.importFromFile) {
            await storageProvider.importFromFile(buffer);
            if (storageProvider.getDocumentCount) {
              const dCount = await storageProvider.getDocumentCount();
              setDocCount(dCount);
            }
            if (storageProvider.getPageCount) {
              const pCount = await storageProvider.getPageCount();
              setPageCount(pCount);
            }
            if (storageProvider.getDatabaseSize) {
              const size = await storageProvider.getDatabaseSize();
              setDbSize(size);
            }
            window.logseq.UI.showMsg('Database imported successfully!', 'success');
          } else {
            window.logseq.UI.showMsg('Import not supported by the current storage backend.', 'error');
          }
        } catch (err: any) {
          console.error('Import failed:', err);
          window.logseq.UI.showMsg(`Import failed: ${err.message}`, 'error');
        }
      }
    };
    reader.onerror = () => {
      window.logseq.UI.showMsg('Failed to read the file.', 'error');
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  const handleOpenDbPanel = async () => {
    setShowMcpPanel(false);
    setShowMemoryPanel(false);
    setShowSkillPanel(false);
    setShowTokenUsagePanel(false);
    setShowAgentPanel(false);
    setShowDbPanel(true);
    if (storageProvider.getDocumentCount) {
      try { const count = await storageProvider.getDocumentCount(); setDocCount(count); } catch { /* ignore */ }
    }
    if (storageProvider.getPageCount) {
      try { const count = await storageProvider.getPageCount(); setPageCount(count); } catch { /* ignore */ }
    }
    if (storageProvider.getDatabaseSize) {
      try { const size = await storageProvider.getDatabaseSize(); setDbSize(size); } catch { /* ignore */ }
    }
  };

  const handleOpenMcpPanel = () => {
    setShowDbPanel(false);
    setShowMemoryPanel(false);
    setShowSkillPanel(false);
    setShowTokenUsagePanel(false);
    setShowAgentPanel(false);
    setShowMcpPanel(prev => !prev);
  };

  const handleOpenMemoryPanel = () => {
    setShowDbPanel(false);
    setShowMcpPanel(false);
    setShowSkillPanel(false);
    setShowTokenUsagePanel(false);
    setShowAgentPanel(false);
    setShowMemoryPanel(prev => !prev);
  };

  const handleOpenSkillPanel = () => {
    setShowDbPanel(false);
    setShowMcpPanel(false);
    setShowMemoryPanel(false);
    setShowTokenUsagePanel(false);
    setShowAgentPanel(false);
    setShowSkillPanel(prev => !prev);
  };

  const handleOpenTokenUsagePanel = () => {
    setShowDbPanel(false);
    setShowMcpPanel(false);
    setShowMemoryPanel(false);
    setShowSkillPanel(false);
    setShowAgentPanel(false);
    setShowTokenUsagePanel(prev => !prev);
  };

  if (!isVisible) return null;

  const buttonProps = getButtonState({ isIndexing, isCooldownActive: cooldownActive });

  return (
    <Overlay onClick={e => {
      if (!panelRef.current?.contains(e.target as Node)) window.logseq.hideMainUI();
    }}>
      <ChatPanel ref={panelRef} className={themeMode === 'dark' ? darkTheme.className : ''} css={{ width: `${panelWidth}px` }}>
        {/* Resize handle */}
        <div
          onMouseDown={handleResizeStart}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            bottom: 0,
            width: '5px',
            cursor: 'col-resize',
            zIndex: 101,
            background: 'transparent',
            transition: 'background 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(139, 92, 246, 0.3)')}
          onMouseLeave={e => { if (!isResizingRef.current) e.currentTarget.style.background = 'transparent'; }}
          title="Drag to resize"
        />
        <ChatHeader
          themeMode={themeMode}
          agents={agents}
          activeAgentId={activeAgentId}
          onAgentSwitch={handleAgentSwitch}
          onManageAgents={handleOpenAgentPanel}
          currentModel={currentModel}
          modelChoices={modelChoices}
          onModelChange={handleModelChange}
          effortValue={settings?.reasoningEffort || 'high'}
          onEffortChange={handleEffortChange}
          onNewSession={handleNewSession}
          memoryStatus={memoryStatus}
          onTrimMessages={handleTrimMessages}
          onClose={() => window.logseq.hideMainUI()}
        />

        <MessagesContainer id="messages-container" className={ctrlHeld ? 'ctrl-held' : ''}>
          <MemoryWarning status={memoryStatus} onTrimMessages={handleTrimMessages} />
          <ChatMessageList
            messages={messages}
            editResults={editResults}
            getBlockMetadata={(uuid) => {
              const provider = storageProvider as any;
              return provider.getBlockMetadata?.(uuid) ?? null;
            }}
            onFileReattach={(file) => setAttachedFiles(prev => [...prev, file])}
            onImageReattach={(image) => setImageDataUrls(prev => [...prev, image])}
          />
          {agentPlan && (
            <AgentProgress
              plan={agentPlan}
              onApprove={() => { setAgentRunning(true); agentLoopRef.current?.run(agentPlan); }}
              onCancel={() => { setAgentPlan(null); setAgentRunning(false); }}
              onStop={() => { agentAbortRef.current?.abort(); agentAbortRef.current = null; setAgentRunning(false); }}
              onEscalationResponse={(answer) => { escalationResolverRef.current?.(answer); setEscalationQuestion(null); }}
              tokensUsed={agentTokensUsed}
              tokenBudget={settings?.agentTokenBudget || 100000}
              escalationQuestion={escalationQuestion}
              isRunning={agentRunning}
              onReplanResponse={(approved) => { replanResolverRef.current?.(approved); setReplanReason(null); setReplanSteps([]); }}
              replanReason={replanReason}
              replanSteps={replanSteps}
              verbose={verboseMode}
              onRetryStep={(stepId) => {
                setAgentPlan(prev => prev ? { ...prev, steps: prev.steps.map(s => s.id === stepId ? { ...s, status: 'pending' as const, error: undefined } : s) } : prev);
              }}
              onSkipStep={(stepId) => {
                setAgentPlan(prev => prev ? { ...prev, steps: prev.steps.map(s => s.id === stepId ? { ...s, status: 'skipped' as const } : s) } : prev);
              }}
            />
          )}
          {loading && (
            <>
              <TypingIndicator>
                <Dot delay={0} /><Dot delay={1} /><Dot delay={2} />
              </TypingIndicator>
              {thinkingText && <div style={{ fontSize: 11, color: '#6b7280', padding: '4px 16px', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{'\uD83D\uDCAD'} {thinkingText.slice(0, 100)}</div>}
            </>
          )}
          <div ref={messagesEndRef} />
        </MessagesContainer>

        {error && (
          <ErrorBanner>
            <span>{'\u26A0\uFE0F'}</span>
            <span style={{ flex: 1 }}>{error}</span>
            <RetryButton onClick={handleSubmit}>Retry</RetryButton>
          </ErrorBanner>
        )}

        <ChatInput
          textareaRef={textareaRef as React.RefObject<HTMLTextAreaElement>}
          inputMessage={inputMessage}
          loading={loading}
          imageDataUrls={imageDataUrls}
          attachedFiles={attachedFiles}
          inputHistory={inputHistory}
          onInputChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onSubmit={handleSubmit}
          onCancel={handleCancel}
          onFile={handleFile}
          onRemoveImage={(i) => setImageDataUrls(prev => prev.filter((_, idx) => idx !== i))}
          onRemoveFile={(i) => setAttachedFiles(prev => prev.filter((_, idx) => idx !== i))}
          onClearHistory={() => setInputHistory([])}
          autoEmbedEnabled={autoEmbedEnabled}
          onAutoEmbedToggle={handleAutoEmbedToggle}
          aiEditMode={aiEditMode}
          onEditToggle={() => setAiEditMode(prev => !prev)}
          agentModeOn={agentModeOn}
          onAgentModeToggle={handleAgentModeToggle}
          verboseMode={verboseMode}
          onVerboseToggle={handleVerboseToggle}
          onOpenDbPanel={handleOpenDbPanel}
          onOpenMcpPanel={handleOpenMcpPanel}
          onOpenMemoryPanel={handleOpenMemoryPanel}
          onOpenSkillPanel={handleOpenSkillPanel}
          onOpenTokenUsagePanel={handleOpenTokenUsagePanel}
          memoryCount={memoryCount}
          skillCount={skillCount}
          isSummarizing={isSummarizing}
          indexButtonProps={buttonProps}
          onIndex={handleIndexDB}
          isIndexing={isIndexing}
          progressCount={progressCount}
          indexingStatus={indexingStatus}
          isDismissing={isDismissing}
          docCount={docCount}
          pageCount={pageCount}
          activePageName={activePageName}
          activeBlockContent={activeBlockContent}
        />

        {showMcpPanel && <MCPServerPanel onClose={() => setShowMcpPanel(false)} />}
        {showMemoryPanel && (
          <MemoryPanel
            onClose={() => setShowMemoryPanel(false)}
            memoryStore={memoryStoreInstance}
            memoryEnabled={(settings?.memoryEnabled as boolean) ?? true}
            onCountChange={setMemoryCount}
          />
        )}
        {showSkillPanel && (
          <SkillPanel
            onClose={() => setShowSkillPanel(false)}
            onCountChange={setSkillCount}
          />
        )}
        {showDbPanel && (
          <DatabasePanel
            storageProvider={storageProvider}
            settings={settings}
            docCount={docCount}
            pageCount={pageCount}
            dbSize={dbSize}
            confirmClearDb={confirmClearDb}
            setConfirmClearDb={setConfirmClearDb}
            setDocCount={setDocCount}
            setPageCount={setPageCount}
            setDbSize={setDbSize}
            fileInputRef={fileInputRef as React.RefObject<HTMLInputElement>}
            onImportFileChange={handleImportFileChange}
            onClose={() => setShowDbPanel(false)}
          />
        )}
        {showTokenUsagePanel && <TokenUsagePanel onClose={() => setShowTokenUsagePanel(false)} />}
        {showAgentPanel && <AgentPanel onClose={() => setShowAgentPanel(false)} onAgentChange={() => setAgents(loadAgents())} />}
      </ChatPanel>
    </Overlay>
  );
}

export default App;
