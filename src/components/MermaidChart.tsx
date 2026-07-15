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

const FixButton = styled('button', {
  fontSize: '11px',
  padding: '4px 10px',
  borderRadius: '4px',
  border: '1px solid $blue6',
  backgroundColor: '$blue3',
  color: '$blue11',
  cursor: 'pointer',
  marginTop: '6px',
  transition: 'all 0.15s',
  '&:hover': {
    backgroundColor: '$blue4',
    borderColor: '$blue7',
  },
  '&:disabled': {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
});

const FixingText = styled('div', {
  fontSize: '11px',
  color: '$blue10',
  padding: '4px 0',
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
});

interface MermaidChartProps {
  code: string;
  onCodeFixed?: (fixedCode: string) => void;
}

function stripSvgDimensions(html: string): string {
  return html
    .replace(/(<svg[^>]*)\s+width="[^"]*"/gi, '$1')
    .replace(/(<svg[^>]*)\s+height="[^"]*"/gi, '$1')
    .replace(/(<svg[^>]*)\s+style="[^"]*"/gi, '$1 style="width:100%;height:100%"');
}

/**
 * Render mermaid code asynchronously using the bundled library but with
 * aggressive isolation: render in a hidden container, with a timeout,
 * and scheduled via requestIdleCallback/setTimeout to avoid blocking
 * the main thread during Logseq interactions.
 */
let mermaidInstance: any = null;
let mermaidLoading: Promise<any> | null = null;

async function getMermaid() {
  if (mermaidInstance) return mermaidInstance;
  if (mermaidLoading) return mermaidLoading;

  mermaidLoading = import('mermaid').then(m => {
    const mermaid = m.default;
    mermaid.initialize({
      startOnLoad: false,
      theme: 'neutral',
      securityLevel: 'loose',
      fontFamily: 'Inter, sans-serif',
      suppressErrorRendering: true,
    });
    mermaidInstance = mermaid;
    return mermaid;
  });

  return mermaidLoading;
}

/**
 * Remove any mermaid error/temp elements from all accessible documents.
 * Only removes elements that are NOT currently being used for active rendering.
 */
let activeRenderId: string | null = null;

function cleanupMermaidDOM() {
  const docs: Document[] = [document];
  try {
    if (top?.document && top.document !== document) docs.push(top.document);
  } catch { /* cross-origin */ }

  for (const doc of docs) {
    // Remove elements containing mermaid error text
    for (let i = doc.body.children.length - 1; i >= 0; i--) {
      const child = doc.body.children[i] as HTMLElement;
      // Skip our active render element
      if (activeRenderId && child.id === activeRenderId) continue;
      // Skip elements that are part of the plugin UI
      if ((child as HTMLElement).dataset?.mixerChart) continue;

      if (
        child.id === 'd' ||
        child.id?.startsWith('dmermaid-') ||
        (child.textContent?.includes('Syntax error in text') && child.textContent?.includes('mermaid version'))
      ) {
        child.remove();
      }
    }
  }
}

/**
 * Perform mermaid rendering with a hard timeout.
 * Returns the SVG string or throws an error.
 */
export async function renderMermaidSafe(code: string, timeoutMs: number = 8000): Promise<string> {
  const mermaid = await getMermaid();

  // Validate syntax first (fast, rarely causes DOM issues)
  try {
    await (mermaid as any).parse(code);
  } catch (e: any) {
    cleanupMermaidDOM();
    throw new Error(e.message || 'Invalid mermaid syntax');
  }

  // Race render against timeout
  const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  activeRenderId = id;

  const renderPromise = (async () => {
    try {
      const { svg } = await mermaid.render(id, code);
      return svg;
    } catch (e: any) {
      throw new Error(e.message || 'Render failed');
    } finally {
      activeRenderId = null;
      // Remove temp element mermaid created
      const tempEl = document.getElementById(id);
      if (tempEl) tempEl.remove();
    }
  })();

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      activeRenderId = null;
      reject(new Error('Render timed out. The diagram may be too complex.'));
      const tempEl = document.getElementById(id);
      if (tempEl) tempEl.remove();
    }, timeoutMs);
  });

  try {
    return await Promise.race([renderPromise, timeoutPromise]);
  } finally {
    cleanupMermaidDOM();
  }
}

const MAX_AUTO_FIX_ATTEMPTS = 2;

export default React.memo(function MermaidChart({ code, onCodeFixed }: MermaidChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [svgContent, setSvgContent] = useState<string | null>(null);
  const renderedCodeRef = useRef<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { isMaximized, open: openMaximize, close: closeMaximize } = useMaximize();
  const [fixing, setFixing] = useState(false);
  const [fixAttempts, setFixAttempts] = useState(0);
  const [autoFixDone, setAutoFixDone] = useState(false);
  const currentCodeRef = useRef(code);
  const attemptedCodesRef = useRef<Set<string>>(new Set());

  // Track current code for auto-fix
  useEffect(() => {
    currentCodeRef.current = code;
    // Only reset fix state when code changes from an external source (user/LLM),
    // not from the fixer. We detect this by checking if the new code was already attempted.
    if (!attemptedCodesRef.current.has(code.trim())) {
      setFixAttempts(0);
      setAutoFixDone(false);
      attemptedCodesRef.current.clear();
    }
  }, [code]);

  useEffect(() => {
    let cancelled = false;
    const trimmedCode = code.trim();

    // Skip if already rendered this code
    if (renderedCodeRef.current === trimmedCode && svgContent) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    // Use setTimeout(0) to yield to the event loop before starting render.
    // This ensures the UI updates (shows "Rendering...") before mermaid
    // potentially blocks the thread.
    const timerId = setTimeout(async () => {
      if (cancelled) return;

      // Pre-render sanitization: fix common Logseq markup patterns
      // that LLMs inject into Mermaid code from RAG context
      const { sanitizeMermaidCode } = await import('../utils/mermaidSanitizer');
      const sanitized = sanitizeMermaidCode(trimmedCode);

      // If sanitizer changed the code, emit the fix and let re-render happen naturally
      if (sanitized !== trimmedCode && onCodeFixed) {
        attemptedCodesRef.current.add(sanitized);
        onCodeFixed(sanitized);
        return;
      }

      try {
        const svg = await renderMermaidSafe(trimmedCode);
        if (!cancelled) {
          setSvgContent(svg);
          renderedCodeRef.current = trimmedCode;
          setError(null);
        }
      } catch (err: any) {
        if (!cancelled) {
          const errorMsg = err.message || 'Failed to render chart';
          setError(errorMsg);
          setSvgContent(null);

          // Auto-fix on first error if we haven't exhausted attempts
          if (fixAttempts < MAX_AUTO_FIX_ATTEMPTS && !autoFixDone && onCodeFixed && !attemptedCodesRef.current.has(trimmedCode)) {
            triggerAutoFix(trimmedCode, errorMsg);
          } else {
            setAutoFixDone(true);
          }
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
        // Always do a final cleanup pass
        cleanupMermaidDOM();
      }
    }, 50); // Small delay to let UI breathe

    return () => {
      cancelled = true;
      clearTimeout(timerId);
      cleanupMermaidDOM();
    };
  }, [code]);

  const triggerAutoFix = async (brokenCode: string, errorMsg: string) => {
    if (!onCodeFixed || fixing) return;

    // Don't re-attempt codes we've already tried to fix
    if (attemptedCodesRef.current.has(brokenCode)) {
      setAutoFixDone(true);
      return;
    }
    attemptedCodesRef.current.add(brokenCode);

    setFixing(true);
    setFixAttempts(prev => prev + 1);

    try {
      const { fixMermaidWithLLM } = await import('../utils/mermaidFixer');
      const settings = (window as any).logseq?.settings ?? (typeof logseq !== 'undefined' ? logseq.settings : null);
      if (!settings) {
        console.warn('[MermaidChart] No settings available for auto-fix');
        setAutoFixDone(true);
        return;
      }

      console.info('[MermaidChart] Attempting auto-fix with model:', settings.selectedModel, 'endpoint:', settings.chatEndpoint || settings.LiteLLMLink);
      const fixedCode = await fixMermaidWithLLM(brokenCode, errorMsg, {
        selectedModel: settings.selectedModel,
        apiKey: settings.apiKey,
        chatEndpoint: settings.chatEndpoint,
        chatProvider: settings.chatProvider,
        LiteLLMLink: settings.LiteLLMLink,
      });

      if (fixedCode && fixedCode !== brokenCode) {
        console.info('[MermaidChart] Auto-fix produced new code, applying...');
        onCodeFixed(fixedCode);
      } else {
        console.warn('[MermaidChart] Auto-fix returned null or same code');
        setAutoFixDone(true);
      }
    } catch (e) {
      console.error('[MermaidChart] Auto-fix failed:', e);
      setAutoFixDone(true);
    } finally {
      setFixing(false);
    }
  };

  const handleManualFix = () => {
    if (!error || !onCodeFixed) return;
    setFixAttempts(0);
    setAutoFixDone(false);
    triggerAutoFix(code.trim(), error);
  };

  // Update visible container when SVG changes
  useEffect(() => {
    if (svgContent && containerRef.current) {
      containerRef.current.innerHTML = svgContent;
    }
  }, [svgContent]);

  if (error) {
    return (
      <ChartContainer>
        <ErrorText>⚠️ Chart render error: {error}</ErrorText>
        {fixing && (
          <FixingText>
            <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>🔄</span>
            Fixing with AI (attempt {fixAttempts}/{MAX_AUTO_FIX_ATTEMPTS})...
          </FixingText>
        )}
        {!fixing && onCodeFixed && (
          <FixButton onClick={handleManualFix} disabled={fixing}>
            🔧 Fix with AI
          </FixButton>
        )}
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

  return (
    <Wrapper>
      <ChartContainer>
        {loading && <LoadingText>Rendering chart...</LoadingText>}
        <div ref={containerRef} data-mixer-chart="true" />
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
