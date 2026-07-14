import React, { useCallback, useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
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

/**
 * Styles injected into the parent document for the fullscreen overlay.
 * We can't use stitches there since it's a different document context.
 */
const OVERLAY_STYLES = `
.mixer-maximize-backdrop {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0, 0, 0, 0.9);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 99999;
  cursor: zoom-out;
  animation: mixer-fade-in 0.15s ease-out;
}
@keyframes mixer-fade-in {
  0% { opacity: 0; }
  100% { opacity: 1; }
}
.mixer-maximize-content {
  max-width: 95vw;
  max-height: 95vh;
  overflow: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: default;
}
.mixer-maximize-content img {
  max-width: 95vw;
  max-height: 90vh;
  object-fit: contain;
  border-radius: 4px;
}
.mixer-maximize-content svg {
  max-width: 95vw;
  max-height: 90vh;
  background: white;
  border-radius: 8px;
  padding: 16px;
}
.mixer-maximize-hint {
  position: fixed;
  top: 16px;
  right: 16px;
  color: rgba(255,255,255,0.7);
  font-size: 13px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  user-select: none;
  z-index: 100000;
}
`;

interface MaximizeOverlayProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

/**
 * Tries to render the overlay in the top-level document (Logseq's main window)
 * to get full desktop-sized display. Falls back to the current iframe if
 * cross-origin restrictions prevent access.
 */
export function MaximizeOverlay({ open, onClose, children }: MaximizeOverlayProps) {
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);
  const containerRef = React.useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) {
      // Clean up when closing
      if (containerRef.current) {
        containerRef.current.remove();
        containerRef.current = null;
        setPortalContainer(null);
      }
      return;
    }

    // Try to render in the top-level document for full desktop size
    let targetDoc: Document;
    try {
      targetDoc = top?.document ?? document;
      // Test access (will throw if cross-origin)
      void targetDoc.body;
    } catch {
      targetDoc = document;
    }

    // Inject styles if not already present
    if (!targetDoc.getElementById('mixer-maximize-styles')) {
      const style = targetDoc.createElement('style');
      style.id = 'mixer-maximize-styles';
      style.textContent = OVERLAY_STYLES;
      targetDoc.head.appendChild(style);
    }

    // Create container for the overlay
    const container = targetDoc.createElement('div');
    container.id = 'mixer-maximize-overlay';
    targetDoc.body.appendChild(container);
    containerRef.current = container;
    setPortalContainer(container);

    return () => {
      container.remove();
      containerRef.current = null;
      setPortalContainer(null);
    };
  }, [open]);

  // Close on Escape key (listen on both documents)
  useEffect(() => {
    if (!open) return;

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', handler);
    try {
      if (top?.document && top.document !== document) {
        top.document.addEventListener('keydown', handler);
      }
    } catch { /* cross-origin */ }

    return () => {
      document.removeEventListener('keydown', handler);
      try {
        if (top?.document && top.document !== document) {
          top.document.removeEventListener('keydown', handler);
        }
      } catch { /* cross-origin */ }
    };
  }, [open, onClose]);

  // Don't render anything when closed
  if (!open) return null;

  // Don't render fallback - wait for portal to be ready
  if (!portalContainer) return null;

  // Render into the top-level document via portal
  return ReactDOM.createPortal(
    <div className="mixer-maximize-backdrop" onClick={onClose}>
      <div className="mixer-maximize-hint">Press Esc or click to close</div>
      <div className="mixer-maximize-content" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
        {children}
      </div>
    </div>,
    portalContainer
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
