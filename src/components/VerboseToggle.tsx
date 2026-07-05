import React from 'react';
import { styled } from '../stitches.config';

const Container = styled('div', {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '5px',
});

const Label = styled('span', {
  fontSize: '$1',
  fontFamily: '$sans',
  color: '$slate11',
  userSelect: 'none',
});

const Track = styled('span', {
  position: 'relative',
  width: '36px',
  height: '20px',
  borderRadius: '$pill',
  cursor: 'pointer',
  transition: 'background-color 0.2s ease',
  outline: 'none',
  '&:focus-visible': {
    boxShadow: '0 0 0 2px $colors$violet7',
  },
  variants: {
    active: {
      true: { backgroundColor: '$violet9' },
      false: { backgroundColor: '$slate6' },
    },
  },
  defaultVariants: { active: false },
});

const Dot = styled('span', {
  position: 'absolute',
  top: '2px',
  width: '16px',
  height: '16px',
  borderRadius: '$pill',
  transition: 'left 0.2s ease, background-color 0.2s ease',
  pointerEvents: 'none',
  variants: {
    active: {
      true: { left: '18px', backgroundColor: 'white' },
      false: { left: '2px', backgroundColor: '$slate9' },
    },
  },
  defaultVariants: { active: false },
});

interface VerboseToggleProps {
  enabled: boolean;
  onToggle: () => void;
}

export function VerboseToggle({ enabled, onToggle }: VerboseToggleProps) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onToggle(); }
  };

  return (
    <Container title={enabled ? 'Verbose Mode: ON — showing detailed agent output' : 'Verbose Mode: OFF — minimal agent output'}>
      <Track
        role="switch"
        aria-checked={enabled}
        aria-label="Agent Verbose Mode"
        tabIndex={0}
        active={enabled}
        onClick={onToggle}
        onKeyDown={handleKeyDown}
      >
        <Dot active={enabled} />
      </Track>
      <Label>📋</Label>
    </Container>
  );
}
