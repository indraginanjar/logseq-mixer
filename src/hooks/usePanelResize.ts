import React, { useCallback, useRef, useState } from 'react';

export function usePanelResize(panelRef: React.RefObject<HTMLDivElement>) {
  const [panelWidth, setPanelWidth] = useState(() => {
    try {
      const maxWidth = window.innerWidth > 0 ? window.innerWidth * 0.85 : 1040;
      // Try logseq settings first (persists across restarts), then localStorage fallback
      const fromSettings = typeof logseq !== 'undefined' && logseq.settings
        ? (logseq.settings.panelWidth as number | undefined)
        : undefined;
      if (typeof fromSettings === 'number' && fromSettings >= 320) {
        return Math.min(fromSettings, maxWidth);
      }
      const saved = localStorage.getItem('logseq-mixer-panel-width');
      if (saved) {
        const parsed = Number(saved);
        if (!isNaN(parsed) && parsed >= 320) {
          return Math.min(parsed, maxWidth);
        }
      }
      return Math.min(1040, maxWidth);
    } catch { return 1040; }
  });
  const isResizingRef = useRef(false);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    const startX = e.clientX;
    const startWidth = panelWidth;

    const onMouseMove = (ev: MouseEvent) => {
      if (!isResizingRef.current) return;
      const delta = startX - ev.clientX;
      const newWidth = Math.max(320, Math.min(startWidth + delta, window.innerWidth * 0.85));
      setPanelWidth(newWidth);
    };

    const onMouseUp = () => {
      isResizingRef.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      // Persist width to both localStorage and logseq settings
      if (panelRef.current) {
        const finalWidth = panelRef.current.offsetWidth;
        try { localStorage.setItem('logseq-mixer-panel-width', String(finalWidth)); } catch {}
        try { logseq.updateSettings({ panelWidth: finalWidth }); } catch {}
      }
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [panelWidth, panelRef]);

  return { panelWidth, isResizingRef, handleResizeStart };
}
