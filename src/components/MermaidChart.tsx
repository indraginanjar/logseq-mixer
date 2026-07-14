import React, { useEffect, useRef, useState } from 'react';
import { styled } from '../stitches.config';
import { MaximizeOverlay, MaximizeButton, useMaximize } from './MaximizeOverlay';

const Wrapper = styled('div', {
  position: 'relative',
  margin: '8px 0',
});

const ChartContainer = styled('div', {
  padding: '12px',
  backgroundColor: '#f8f9fa',
  borderRadius: '8px',
  border: '1px solid $slate5',
  overflow: 'auto',
  backgroundImage: 'linear-gradient(45deg, #e9ecef 25%, transparent 25%), linear-gradient(-45deg, #e9ecef 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e9ecef 75%), linear-gradient(-45deg, transparent 75%, #e9ecef 75%)',
  backgroundSize: '20px 20px',
  backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
  '& svg': {
    maxWidth: '100%',
    height: 'auto',
  },
});

const CopyButton = styled('button', {
  position: 'absolute',
  top: '8px',
  right: '8px',
  fontSize: '11px',
  padding: '4px 8px',
  borderRadius: '4px',
  border: '1px solid $slate6',
  backgroundColor: '$elevation1',
  color: '$slate11',
  cursor: 'pointer',
  opacity: 0.7,
  transition: 'opacity 0.15s',
  '&:hover': {
    opacity: 1,
    backgroundColor: '$slate3',
  },
});

const ErrorText = styled('div', {
  fontSize: '11px',
  color: '$red11',
  padding: '8px',
});

const LoadingText = styled('div', {
  fontSize: '11px',
  color: '$slate10',
  padding: '8px',
});

let mermaidInitialized = false;

async function getMermaid() {
  const mermaid = (await import('mermaid')).default;
  if (!mermaidInitialized) {
    mermaid.initialize({
      startOnLoad: false,
      theme: 'neutral',
      securityLevel: 'strict',
      fontFamily: 'Inter, sans-serif',
      // Suppress mermaid's default error rendering which injects elements into the body
      suppressErrorRendering: true,
    });
    mermaidInitialized = true;
  }
  return mermaid;
}

/**
 * Remove any orphaned mermaid error elements from the document.
 * Mermaid v11 may inject elements with class "error-icon" or "mermaid"
 * containing error text directly into document.body on parse failures.
 */
function cleanupMermaidErrors() {
  // Remove floating error divs that mermaid injects
  const errorElements = document.querySelectorAll(
    '#d, [data-mermaid-error], .mermaid-error, [id^="mermaid-"] .error-icon'
  );
  errorElements.forEach(el => el.remove());

  // Also check for any direct children of body that contain mermaid error text
  const bodyChildren = document.body.children;
  for (let i = bodyChildren.length - 1; i >= 0; i--) {
    const child = bodyChildren[i] as HTMLElement;
    if (
      child.id?.startsWith('dmermaid-') ||
      child.id === 'd' ||
      (child.textContent?.includes('Syntax error in text') && child.textContent?.includes('mermaid version'))
    ) {
      child.remove();
    }
  }
}

interface MermaidChartProps {
  code: string;
}

export default React.memo(function MermaidChart({ code }: MermaidChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const renderedCodeRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Skip if we've already rendered this exact code
    if (renderedCodeRef.current === code.trim()) {
      setLoading(false);
      return;
    }

    const render = async () => {
      try {
        const mermaid = await getMermaid();
        const trimmedCode = code.trim();

        // Validate syntax before attempting render to avoid DOM pollution
        try {
          await (mermaid as any).parse(trimmedCode);
        } catch (parseErr: any) {
          // Clean up any error elements mermaid may have injected during parse
          cleanupMermaidErrors();
          if (!cancelled) {
            setError(parseErr.message || 'Invalid mermaid syntax');
            setLoading(false);
          }
          return;
        }

        const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        // Render in a try block with cleanup
        try {
          const { svg } = await mermaid.render(id, trimmedCode);
          if (!cancelled && containerRef.current) {
            containerRef.current.innerHTML = svg;
            setError(null);
            renderedCodeRef.current = trimmedCode;
          }
        } catch (renderErr: any) {
          // Clean up any orphaned error elements
          cleanupMermaidErrors();
          // Also remove the temp element mermaid may have created
          const tempEl = document.getElementById(id);
          if (tempEl) tempEl.remove();
          if (!cancelled) setError(renderErr.message || 'Failed to render chart');
        }
      } catch (err: any) {
        cleanupMermaidErrors();
        if (!cancelled) setError(err.message || 'Failed to load mermaid');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    render();
    return () => {
      cancelled = true;
      // Clean up on unmount in case render was mid-flight
      cleanupMermaidErrors();
    };
  }, [code]);

  if (error) {
    return (
      <ChartContainer>
        <ErrorText>⚠️ Chart render error: {error}</ErrorText>
        <pre style={{ fontSize: '11px', color: '#64748b', whiteSpace: 'pre-wrap', margin: '4px 0 0' }}>{code}</pre>
      </ChartContainer>
    );
  }

  const handleCopy = async () => {
    try {
      const svgEl = containerRef.current?.querySelector('svg');
      if (!svgEl) return;
      const bbox = svgEl.getBoundingClientRect();
      const width = bbox.width || svgEl.clientWidth || 400;
      const height = bbox.height || svgEl.clientHeight || 300;
      const svgData = new XMLSerializer().serializeToString(svgEl);
      const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);
      const img = new Image();
      img.onload = async () => {
        const canvas = document.createElement('canvas');
        const scale = 2;
        canvas.width = width * scale;
        canvas.height = height * scale;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0, width, height);
        URL.revokeObjectURL(url);
        canvas.toBlob(async (blob) => {
          if (!blob) return;
          try {
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            await navigator.clipboard.writeText(svgData);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }
        }, 'image/png');
      };
      img.src = url;
    } catch { /* ignore */ }
  };

  const [copied, setCopied] = useState(false);
  const { isMaximized, open: openMaximize, close: closeMaximize } = useMaximize();

  return (
    <Wrapper>
      <ChartContainer>
        {loading && <LoadingText>Rendering chart...</LoadingText>}
        <div ref={containerRef} />
      </ChartContainer>
      {!loading && !error && (
        <CopyButton onClick={handleCopy} title="Copy chart as image">
          {copied ? '✓ Copied' : '📋 Copy Image'}
        </CopyButton>
      )}
      {!loading && !error && (
        <MaximizeButton
          onClick={openMaximize}
          title="View fullscreen"
          style={{ position: 'absolute', top: 8, right: 108 }}
        >
          ⛶ Maximize
        </MaximizeButton>
      )}
      <MaximizeOverlay open={isMaximized} onClose={closeMaximize}>
        <div dangerouslySetInnerHTML={{ __html: containerRef.current?.innerHTML || '' }} />
      </MaximizeOverlay>
    </Wrapper>
  );
});
