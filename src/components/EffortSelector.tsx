import React, { useCallback, useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { styled } from '../stitches.config';

const EFFORT_LEVELS = [
  { value: 'low', trigger: '⚡Low', label: 'Low', description: 'Fastest, cheapest' },
  { value: 'medium', trigger: '⚡Med', label: 'Medium', description: 'Balanced speed/quality' },
  { value: 'high', trigger: '⚡High', label: 'High', description: 'Default, thorough' },
  { value: 'xhigh', trigger: '⚡XH', label: 'XHigh', description: 'Extended reasoning' },
  { value: 'max', trigger: '⚡Max', label: 'Max', description: 'Maximum capability' },
] as const;

const Wrapper = styled('div', {
  position: 'relative',
  maxWidth: '80px',
  minWidth: '56px',
  flexShrink: 1,
});

const Trigger = styled('button', {
  background: 'transparent',
  border: '1px solid $slate6',
  borderRadius: '6px',
  padding: '4px 8px',
  cursor: 'pointer',
  color: '$highContrast',
  fontSize: '11px',
  fontWeight: 500,
  transition: 'all 0.15s',
  outline: 'none',
  fontFamily: '$sans',
  width: '100%',
  boxSizing: 'border-box',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  textAlign: 'left',
  '&:hover': { backgroundColor: '$slate3', borderColor: '$slate8' },
  '&:focus': { borderColor: '$blue8' },
});

const Dropdown = styled('div', {
  position: 'fixed',
  backgroundColor: '$elevation0',
  border: '1px solid $slate6',
  borderRadius: '6px',
  boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
  zIndex: 9999,
  overflow: 'hidden',
  minWidth: '180px',
});

const OptionList = styled('div', {
  maxHeight: '200px',
  overflowY: 'auto',
  '&::-webkit-scrollbar': { width: '4px' },
  '&::-webkit-scrollbar-thumb': { backgroundColor: '$slate6', borderRadius: '2px' },
});

const Option = styled('div', {
  padding: '6px 10px',
  fontSize: '12px',
  cursor: 'pointer',
  color: '$slate11',
  display: 'flex',
  flexDirection: 'column',
  gap: '1px',
  '&:hover': { backgroundColor: '$slate3', color: '$highContrast' },
  variants: {
    active: {
      true: { backgroundColor: '$blue4', color: '$blue11' },
    },
  },
});

const OptionLabel = styled('span', {
  fontWeight: 500,
  fontSize: '12px',
});

const OptionDesc = styled('span', {
  fontSize: '10px',
  color: '$slate9',
});

interface EffortSelectorProps {
  value: string;
  onChange: (level: string) => void;
}

export default function EffortSelector({ value, onChange }: EffortSelectorProps) {
  const [open, setOpen] = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const currentLevel = EFFORT_LEVELS.find(l => l.value === value) || EFFORT_LEVELS[2];

  const handleSelect = useCallback((level: string) => {
    onChange(level);
    setOpen(false);
  }, [onChange]);

  const updateDropdownPosition = () => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setDropdownStyle({
        top: rect.bottom + 2,
        left: rect.left,
        width: Math.max(rect.width, 180),
      });
    }
  };

  const handleToggle = () => {
    if (!open) {
      updateDropdownPosition();
    }
    setOpen(prev => !prev);
  };

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrapperRef.current?.contains(target)) return;
      if ((target as HTMLElement).closest?.('[data-effort-dropdown]')) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  const dropdown = open && ReactDOM.createPortal(
    <Dropdown style={dropdownStyle} data-effort-dropdown="true">
      <OptionList>
        {EFFORT_LEVELS.map(level => (
          <Option
            key={level.value}
            active={level.value === value}
            onMouseDown={(e) => { e.preventDefault(); handleSelect(level.value); }}
          >
            <OptionLabel>{level.trigger} — {level.label}</OptionLabel>
            <OptionDesc>{level.description}</OptionDesc>
          </Option>
        ))}
      </OptionList>
    </Dropdown>,
    document.body
  );

  return (
    <Wrapper ref={wrapperRef}>
      <Trigger
        ref={triggerRef}
        onClick={handleToggle}
        aria-label="Select Reasoning Effort"
        title={`Reasoning Effort: ${currentLevel.label}`}
      >
        {currentLevel.trigger}
      </Trigger>
      {dropdown}
    </Wrapper>
  );
}
