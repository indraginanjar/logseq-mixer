import React from 'react';
import { styled } from '../stitches.config';
import ModelSelector from './ModelSelector';
import EffortSelector from './EffortSelector';
import { MemoryIndicator } from './MemoryIndicator';
import type { MemoryStatus } from '../hooks/useMemoryMonitor';

// --- Styled Components ---

const Header = styled('div', {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '12px 16px',
  borderBottom: '1px solid $slate6',
  backgroundColor: '$elevation0',
});

const HeaderLeft = styled('div', {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
});

const LogoIcon = styled('img', { width: '18px', height: '18px', borderRadius: '4px' });

const Title = styled('h2', {
  margin: 0,
  fontSize: '15px',
  fontWeight: 600,
  color: '$highContrast',
});

const CloseButton = styled('button', {
  background: 'transparent',
  border: 'none',
  width: '28px',
  height: '28px',
  borderRadius: '6px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  color: '$slate9',
  fontSize: '14px',
  transition: 'all 0.15s',
  '&:hover': { backgroundColor: '$slate3', color: '$highContrast' },
});

const HeaderRight = styled('div', {
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
  overflow: 'hidden',
  minWidth: 0,
});

const HeaderButton = styled('button', {
  background: 'transparent',
  border: '1px solid $slate6',
  borderRadius: '6px',
  padding: '4px 8px',
  cursor: 'pointer',
  color: '$slate10',
  fontSize: '12px',
  fontWeight: 500,
  transition: 'all 0.15s',
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
  flexShrink: 0,
  whiteSpace: 'nowrap',
  '&:hover': { backgroundColor: '$slate3', borderColor: '$slate8', color: '$highContrast' },
});

// --- Props ---

interface ChatHeaderProps {
  themeMode: string;
  currentModel: string;
  modelChoices: string[];
  onModelChange: (model: string) => void;
  effortValue: string;
  onEffortChange: (level: string) => void;
  onNewSession: () => void;
  memoryStatus: MemoryStatus;
  onTrimMessages: () => void;
  onClose: () => void;
}

// --- Component ---

export function ChatHeader({
  themeMode,
  currentModel,
  modelChoices,
  onModelChange,
  effortValue,
  onEffortChange,
  onNewSession,
  memoryStatus,
  onTrimMessages,
  onClose,
}: ChatHeaderProps) {
  return (
    <Header>
      <HeaderLeft>
        <LogoIcon src={themeMode === 'dark' ? 'icon-dark-transparent.png' : 'icon.png'} alt="Mixer Logo" />
        <Title>Mixer</Title>
      </HeaderLeft>
      <HeaderRight>
        <ModelSelector
          value={currentModel}
          choices={modelChoices}
          onChange={onModelChange}
        />
        <EffortSelector value={effortValue} onChange={onEffortChange} />
        <HeaderButton onClick={onNewSession} aria-label="New Session" title="New Session">&#x2728; New</HeaderButton>
        <MemoryIndicator status={memoryStatus} onTrimMessages={onTrimMessages} />
        <CloseButton onClick={onClose} aria-label="Close" title="Close">&#x2715;</CloseButton>
      </HeaderRight>
    </Header>
  );
}

export default ChatHeader;
