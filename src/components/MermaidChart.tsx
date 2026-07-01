import React, { useEffect, useRef, useState } from 'react';
import { styled } from '../stitches.config';

const ChartContainer = styled('div', {
  margin: '8px 0',
  padding: '12px',
  backgroundColor: 'white',
  borderRadius: '8px',
  border: '1px solid $slate5',
  overflow: 'auto',
  '& svg': {
    maxWidth: '100%',
    height: 'auto',
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
    });
    mermaidInitialized = true;
  }
  return mermaid;
}

interface MermaidChartProps {
  code: string;
}

export default function MermaidChart({ code }: MermaidChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const render = async () => {
      try {
        const mermaid = await getMermaid();
        const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const { svg } = await mermaid.render(id, code.trim());
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
          setError(null);
        }
      } catch (err: any) {
        if (!cancelled) setError(err.message || 'Failed to render chart');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    render();
    return () => { cancelled = true; };
  }, [code]);

  if (error) {
    return (
      <ChartContainer>
        <ErrorText>⚠️ Chart render error: {error}</ErrorText>
        <pre style={{ fontSize: '11px', color: '#64748b', whiteSpace: 'pre-wrap', margin: '4px 0 0' }}>{code}</pre>
      </ChartContainer>
    );
  }

  return (
    <ChartContainer>
      {loading && <LoadingText>Rendering chart...</LoadingText>}
      <div ref={containerRef} />
    </ChartContainer>
  );
}
