import React, { useState, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { styled } from '../stitches.config';

// --- Styled Components ---

const Wrapper = styled('div', {
  position: 'relative',
  flexShrink: 0,
});

const Trigger = styled('button', {
  background: 'transparent',
  border: '1px solid $slate6',
  borderRadius: '6px',
  padding: '4px 8px',
  cursor: 'pointer',
  color: '$highContrast',
  fontSize: '12px',
  fontWeight: 500,
  transition: 'all 0.15s',
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
  maxWidth: '120px',
  whiteSpace: 'nowrap',
  '&:hover': { backgroundColor: '$slate3', borderColor: '$slate8' },
});

const TriggerName = styled('span', {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

const ChevronIcon = styled('span', {
  fontSize: '10px',
  color: '$slate9',
  flexShrink: 0,
});

const Dropdown = styled('div', {
  position: 'fixed',
  backgroundColor: '$elevation0',
  border: '1px solid $slate6',
  borderRadius: '6px',
  boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
  zIndex: 9999,
  overflow: 'hidden',
  minWidth: '160px',
});

const OptionList = styled('div', {
  maxHeight: '200px',
  overflowY: 'auto',
  '&::-webkit-scrollbar': { width: '4px' },
  '&::-webkit-scrollbar-thumb': { backgroundColor: '$slate6', borderRadius: '2px' },
});

const Option = styled('div', {
  padding: '5px 8px',
  fontSize: '12px',
  cursor: 'pointer',
  color: '$slate11',
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  '&:hover': { backgroundColor: '$slate3', color: '$highContrast' },
  variants: {
    active: {
      true: { backgroundColor: '$blue4', color: '$blue11' },
    },
  },
});

const OptionName = styled('span', {
  flex: 1,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

const Checkmark = styled('span', {
  fontSize: '11px',
  flexShrink: 0,
});

const Divider = styled('div', {
  height: '1px',
  backgroundColor: '$slate6',
});

const FooterItem = styled('div', {
  padding: '5px 8px',
  fontSize: '12px',
  cursor: 'pointer',
  color: '$slate9',
  fontWeight: 500,
  '&:hover': { backgroundColor: '$slate3', color: '$highContrast' },
});

// --- Props ---

interface AgentSelectorProps {
  agents: Array<{ id: string; name: string; icon: string; isDefault: boolean }>;
  activeAgentId: string | null;
  onSwitch: (agentId: string) => void;
  onManage: () => void;
}

// --- Component ---

export default function AgentSelector({ agents, activeAgentId, onSwitch, onManage }: AgentSelectorProps) {
  const [open, setOpen] = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const activeAgent = agents.find(a => a.id === activeAgentId) ?? agents.find(a => a.isDefault) ?? agents[0];

  const updateDropdownPosition = () => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setDropdownStyle({
        top: rect.bottom + 2,
        left: rect.left,
        minWidth: Math.max(rect.width, 160),
      });
    }
  };

  const handleToggle = () => {
    if (!open) updateDropdownPosition();
    setOpen(prev => !prev);
  };

  const handleSelect = (agentId: string) => {
    onSwitch(agentId);
    setOpen(false);
  };

  const handleManage = () => {
    onManage();
    setOpen(false);
  };

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrapperRef.current?.contains(target)) return;
      if ((target as HTMLElement).closest?.('[data-agent-dropdown]')) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  const dropdown = open && ReactDOM.createPortal(
    <Dropdown style={dropdownStyle} data-agent-dropdown="true">
      <OptionList>
        {agents.map(agent => (
          <Option
            key={agent.id}
            active={agent.id === activeAgentId}
            onMouseDown={(e) => { e.preventDefault(); handleSelect(agent.id); }}
            title={agent.name}
          >
            <span>{agent.icon}</span>
            <OptionName>{agent.name}</OptionName>
            {agent.id === activeAgentId && <Checkmark>✓</Checkmark>}
          </Option>
        ))}
      </OptionList>
      <Divider />
      <FooterItem onMouseDown={(e) => { e.preventDefault(); handleManage(); }}>
        Manage Agents →
      </FooterItem>
    </Dropdown>,
    document.body
  );

  if (!activeAgent) return null;

  return (
    <Wrapper ref={wrapperRef}>
      <Trigger ref={triggerRef} onClick={handleToggle} aria-label="Select Agent" title={activeAgent.name}>
        <span>{activeAgent.icon}</span>
        <TriggerName>{activeAgent.name}</TriggerName>
        <ChevronIcon>▾</ChevronIcon>
      </Trigger>
      {dropdown}
    </Wrapper>
  );
}
