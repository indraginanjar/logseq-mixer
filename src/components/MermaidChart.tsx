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

interface MermaidChartProps {
  code: string;
}

/**
 * Strip fixed width/height attributes from SVG elements so they can
 * scale to fill their container in the maximize view.
 */
function stripSvgDimensions(html: string): string {
  return html
    .replace(/(<svg[^>]*)\s+width="[^"]*"/gi, '$1')
    .replace(/(<svg[^>]*)\s+height="[^"]*"/gi, '$1')
    .replace(/(<svg[^>]*)\s+style="[^"]*"/gi, '$1 style="width:100%;height:100%"');
}

/**
 * Renders mermaid diagrams inside a sandboxed iframe to completely isolate
 * mermaid's DOM manipulation from the host document (Logseq).
 *
 * This prevents mermaid from injecting error elements, measurement divs,
 * or any other DOM pollution into Logseq's document that could block UI.
 *
 * The iframe loads mermaid from CDN, renders the diagram, and communicates
 * the resulting SVG back via postMessage.
 */
export default React.memo(function MermaidChart({ code }: MermaidChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [svgContent, setSvgContent] = useState<string | null>(null);
  const renderedCodeRef = useRef<string | null>(null);

  useEffect(() => {
    const trimmedCode = code.trim();

    // Skip if already rendered this code
    if (renderedCodeRef.current === trimmedCode && svgContent) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    // Timeout to prevent infinite hanging
    const timeout = setTimeout(() => {
      setError('Render timed out (10s). The diagram may be too complex or have syntax errors.');
      setLoading(false);
      cleanup();
    }, 10000);

    // Listen for message from iframe
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'mermaid-result') {
        clearTimeout(timeout);
        if (event.data.error) {
          setError(event.data.error);
          setSvgContent(null);
        } else {
          setSvgContent(event.data.svg);
          renderedCodeRef.current = trimmedCode;
          setError(null);
        }
        setLoading(false);
        cleanup();
      }
    };

    window.addEventListener('message', handleMessage);

    // Create sandboxed iframe for rendering
    const iframe = document.createElement('iframe');
    iframe.style.position = 'absolute';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = 'none';
    iframe.style.visibility = 'hidden';
    iframe.style.pointerEvents = 'none';
    // sandbox allows scripts but nothing else — no DOM access to parent
    iframe.setAttribute('sandbox', 'allow-scripts');
    document.body.appendChild(iframe);
    iframeRef.current = iframe;

    // Write the mermaid rendering script into the iframe
    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
    if (iframeDoc) {
      iframeDoc.open();
      iframeDoc.write(buildIframeHTML(trimmedCode));
      iframeDoc.close();
    } else {
      clearTimeout(timeout);
      setError('Failed to create render sandbox');
      setLoading(false);
    }

    function cleanup() {
      window.removeEventListener('message', handleMessage);
      if (iframeRef.current) {
        iframeRef.current.remove();
        iframeRef.current = null;
      }
    }

    return () => {
      clearTimeout(timeout);
      cleanup();
    };
  }, [code]);

  // Update the visible container when SVG content changes
  useEffect(() => {
    if (svgContent && containerRef.current) {
      containerRef.current.innerHTML = svgContent;
    }
  }, [svgContent]);

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
      {!loading && !error && svgContent && (
        <CopyButton onClick={handleCopy} title="Copy chart as image">
          {copied ? '✓ Copied' : '📋 Copy Image'}
        </CopyButton>
      )}
      {!loading && !error && svgContent && (
        <MaximizeButton
          onClick={openMaximize}
          title="View fullscreen"
          style={{ position: 'absolute', top: 8, right: 108 }}
        >
          ⛶ Maximize
        </MaximizeButton>
      )}
      <MaximizeOverlay open={isMaximized} onClose={closeMaximize}>
        <div dangerouslySetInnerHTML={{ __html: stripSvgDimensions(svgContent || '') }} />
      </MaximizeOverlay>
    </Wrapper>
  );
});

/**
 * Build the HTML content for the sandboxed iframe.
 * Loads mermaid from CDN (esm.sh) and renders the diagram,
 * posting the result back to the parent via postMessage.
 */
function buildIframeHTML(code: string): string {
  // Escape the code for safe embedding in a script
  const escapedCode = JSON.stringify(code);

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body>
<div id="render-target"></div>
<script type="module">
import mermaid from 'https://esm.sh/mermaid@11/dist/mermaid.esm.min.mjs';

mermaid.initialize({
  startOnLoad: false,
  theme: 'neutral',
  securityLevel: 'strict',
  fontFamily: 'Inter, sans-serif',
  suppressErrorRendering: true,
});

const code = ${escapedCode};

try {
  // Validate first
  await mermaid.parse(code);
  // Render
  const { svg } = await mermaid.render('diagram', code);
  parent.postMessage({ type: 'mermaid-result', svg: svg }, '*');
} catch (err) {
  parent.postMessage({ type: 'mermaid-result', error: err.message || 'Render failed' }, '*');
}
</script>
</body>
</html>`;
}
