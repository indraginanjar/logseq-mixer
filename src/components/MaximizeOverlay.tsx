import React, { useCallback, useEffect, useState } from 'react';
import { keyframes, styled } from '../stitches.config';

const fadeIn = keyframes({
  '0%': { opacity: 0 },
  '100%': { opacity: 1 },
});

const Backdrop = styled('div', {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: 'rgba(0, 0, 0, 0.85)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 9999,
  animation: `${fadeIn} 0.15s ease-out`,
  cursor: 'zoom-out',
});

const ContentWrapper = styled('div', {
  maxWidth: '95vw',
  maxHeight: '95vh',
  overflow: 'auto',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'default',
  '& img': {
    maxWidth: '95vw',
    maxHeight: '90vh',
    objectFit: 'contain',
    borderRadius: '4px',
  },
  '& svg': {
    maxWidth: '95vw',
    maxHeight: '90vh',
  },
});

const CloseHint = styled('div', {
  position: 'fixed',
  top: '16px',
  right: '16px',
  color: 'rgba(255, 255, 255, 0.7)',
  fontSize: '13px',
  fontFamily: '$sans',
  userSelect: 'none',
  zIndex: 10000,
});

export const MaximizeButton = styled('button', {
  fontSize: '11px',
  padding: '4px 8px',
  borderRadius: '4px',
  border: '1px solid $slate6',
  backgroundColor: '$elevation1',
  color: '$slate11',
  cursor: 'pointer',
  opacity: 0.7,
  transition: 'opacity 0.15s',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '3px',
  fontFamily: '$sans',
  '&:hover': {
    opacity: 1,
    backgroundColor: '$slate3',
  },
});

/** Inline style version for use inside markdown img renderer */
export const maximizeButtonStyle: React.CSSProperties = {
  position: 'absolute',
  top: 4,
  right: 36,
  fontSize: 11,
  padding: '2px 6px',
  borderRadius: 4,
  border: '1px solid rgba(0,0,0,0.2)',
  background: 'rgba(255,255,255,0.9)',
  cursor: 'pointer',
};

interface MaximizeOverlayProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

export function MaximizeOverlay({ open, onClose, children }: MaximizeOverlayProps) {
  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <Backdrop onClick={onClose}>
      <CloseHint>Press Esc or click to close</CloseHint>
      <ContentWrapper onClick={(e) => e.stopPropagation()}>
        {children}
      </ContentWrapper>
    </Backdrop>
  );
}

/**
 * Hook to manage maximize state for a chart/image.
 */
export function useMaximize() {
  const [isMaximized, setIsMaximized] = useState(false);
  const open = useCallback(() => setIsMaximized(true), []);
  const close = useCallback(() => setIsMaximized(false), []);
  return { isMaximized, open, close };
}
