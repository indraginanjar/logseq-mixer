import React, { useCallback, useRef, useState } from 'react';

export function usePanelResize(panelRef: React.RefObject<HTMLDivElement>) {
  const [panelWidth, setPanelWidth] = useState(() => {
    try {
      const saved = localStorage.getItem('logseq-mixer-panel-width');
      return saved ? Math.max(320, Math.min(Number(saved), window.innerWidth * 0.85)) : 520;
    } catch { return 520; }
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
      // Persist width from the panel element's current computed width
      if (panelRef.current) {
        const finalWidth = panelRef.current.offsetWidth;
        try { localStorage.setItem('logseq-mixer-panel-width', String(finalWidth)); } catch {}
      }
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [panelWidth, panelRef]);

  return { panelWidth, isResizingRef, handleResizeStart };
}
