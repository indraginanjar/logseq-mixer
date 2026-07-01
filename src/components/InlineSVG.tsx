import React, { useMemo } from 'react';
import { styled } from '../stitches.config';

const SVGContainer = styled('div', {
  margin: '8px 0',
  padding: '8px',
  backgroundColor: '$slate1',
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

// Remove dangerous elements and attributes from SVG
function sanitizeSVG(svgString: string): string {
  // Remove script tags and event handlers
  let clean = svgString
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/data:/gi, 'data-blocked:');

  // Ensure it starts with <svg
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

  if (!sanitized) return null;

  return (
    <SVGContainer dangerouslySetInnerHTML={{ __html: sanitized }} />
  );
}
