import React, { useMemo, useRef, useState } from 'react';
import { styled } from '../stitches.config';

const Wrapper = styled('div', {
  position: 'relative',
  margin: '8px 0',
});

const SVGContainer = styled('div', {
  padding: '12px',
  backgroundColor: 'white',
  borderRadius: '8px',
  border: '1px solid $slate5',
  overflow: 'auto',
  display: 'flex',
  justifyContent: 'center',
  '& svg': {
    maxWidth: '100%',
    height: 'auto',
  },
});

const ButtonRow = styled('div', {
  position: 'absolute',
  top: '8px',
  right: '8px',
  display: 'flex',
  gap: '4px',
});

const CopyButton = styled('button', {
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

// Remove dangerous elements and attributes from SVG
function sanitizeSVG(svgString: string): string {
  let clean = svgString
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/javascript:/gi, '');

  const svgStart = clean.indexOf('<svg');
  if (svgStart === -1) return '';
  const svgEnd = clean.lastIndexOf('</svg>');
  if (svgEnd === -1) return '';
  clean = clean.slice(svgStart, svgEnd + 6);

  return clean;
}

interface InlineSVGProps {
  content: string;
}

export default function InlineSVG({ content }: InlineSVGProps) {
  const sanitized = useMemo(() => sanitizeSVG(content), [content]);
  const containerRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState<'png' | 'svg' | null>(null);

  if (!sanitized) return null;

  const handleCopySVG = async () => {
    try {
      await navigator.clipboard.writeText(sanitized);
      setCopied('svg');
      setTimeout(() => setCopied(null), 2000);
    } catch { /* ignore */ }
  };

  const handleCopyPNG = async () => {
    try {
      const svgEl = containerRef.current?.querySelector('svg');
      if (!svgEl) return;

      const bbox = svgEl.getBoundingClientRect();
      const width = bbox.width || svgEl.clientWidth || 300;
      const height = bbox.height || svgEl.clientHeight || 150;

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
            await navigator.clipboard.write([
              new ClipboardItem({ 'image/png': blob }),
            ]);
            setCopied('png');
            setTimeout(() => setCopied(null), 2000);
          } catch { /* ignore */ }
        }, 'image/png');
      };
      img.src = url;
    } catch { /* ignore */ }
  };

  return (
    <Wrapper>
      <SVGContainer ref={containerRef} dangerouslySetInnerHTML={{ __html: sanitized }} />
      <ButtonRow>
        <CopyButton onClick={handleCopySVG} title="Copy SVG source code">
          {copied === 'svg' ? '✓ Copied' : '📄 SVG'}
        </CopyButton>
        <CopyButton onClick={handleCopyPNG} title="Copy as PNG image">
          {copied === 'png' ? '✓ Copied' : '🖼️ PNG'}
        </CopyButton>
      </ButtonRow>
    </Wrapper>
  );
}
