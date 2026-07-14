import React from 'react';
import { styled, keyframes } from '../stitches.config';
import type { MemoryStatus } from '../hooks/useMemoryMonitor';

const pulseAnimation = keyframes({
  '0%, 100%': { opacity: 1 },
  '50%': { opacity: 0.5 },
});

const Container = styled('div', {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  fontSize: '11px',
  fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
  padding: '3px 8px',
  borderRadius: '4px',
  userSelect: 'none',
  cursor: 'default',
  transition: 'all 0.3s ease',
  variants: {
    pressure: {
      low: {
        color: '$slate9',
        backgroundColor: 'transparent',
      },
      moderate: {
        color: '$amber11',
        backgroundColor: '$amber2',
      },
      high: {
        color: '$orange11',
        backgroundColor: '$orange3',
        fontWeight: 500,
      },
      critical: {
        color: '$red11',
        backgroundColor: '$red3',
        fontWeight: 600,
        animation: `${pulseAnimation} 1.5s ease-in-out infinite`,
      },
    },
  },
});

const Dot = styled('span', {
  width: '6px',
  height: '6px',
  borderRadius: '50%',
  flexShrink: 0,
  variants: {
    pressure: {
      low: { backgroundColor: '$green9' },
      moderate: { backgroundColor: '$amber9' },
      high: { backgroundColor: '$orange9' },
      critical: { backgroundColor: '$red9' },
    },
  },
});

const WarningBanner = styled('div', {
  padding: '8px 12px',
  fontSize: '12px',
  lineHeight: 1.4,
  borderRadius: '6px',
  margin: '0 0 8px 0',
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  variants: {
    level: {
      high: {
        backgroundColor: '$orange3',
        border: '1px solid $orange7',
        color: '$orange12',
      },
      critical: {
        backgroundColor: '$red3',
        border: '1px solid $red7',
        color: '$red12',
      },
    },
  },
});

const TrimButton = styled('button', {
  background: 'none',
  border: '1px solid currentColor',
  borderRadius: '4px',
  padding: '2px 8px',
  fontSize: '11px',
  fontWeight: 500,
  cursor: 'pointer',
  color: 'inherit',
  opacity: 0.9,
  marginLeft: 'auto',
  flexShrink: 0,
  '&:hover': {
    opacity: 1,
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
});

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  return mb < 100 ? `${mb.toFixed(1)} MB` : `${Math.round(mb)} MB`;
}

interface MemoryIndicatorProps {
  status: MemoryStatus;
  onTrimMessages?: () => void;
}

export function MemoryIndicator({ status, onTrimMessages }: MemoryIndicatorProps) {
  if (status.pressure === 'low') {
    // Show minimal indicator when everything is fine
    return (
      <Container pressure="low" title={getTooltip(status)}>
        <Dot pressure="low" />
        <span>{status.messageCount} msgs</span>
      </Container>
    );
  }

  return (
    <Container pressure={status.pressure} title={getTooltip(status)}>
      <Dot pressure={status.pressure} />
      <span>
        {status.messageCount} msgs
        {status.isSupported && ` · ${formatBytes(status.heapUsed)}`}
      </span>
    </Container>
  );
}

interface MemoryWarningProps {
  status: MemoryStatus;
  onTrimMessages?: () => void;
}

export function MemoryWarning({ status, onTrimMessages }: MemoryWarningProps) {
  if (status.pressure !== 'high' && status.pressure !== 'critical') {
    return null;
  }

  const isCritical = status.pressure === 'critical';

  return (
    <WarningBanner level={status.pressure}>
      <span>{isCritical ? '🚨' : '⚠️'}</span>
      <span>
        {isCritical
          ? 'Memory critically high — plugin may crash. Clear chat or trim old messages.'
          : 'Memory usage is high. Consider clearing older messages.'}
        {status.isSupported && ` (${formatBytes(status.heapUsed)}/${formatBytes(status.heapLimit)})`}
      </span>
      {onTrimMessages && (
        <TrimButton onClick={onTrimMessages}>
          Trim
        </TrimButton>
      )}
    </WarningBanner>
  );
}

function getTooltip(status: MemoryStatus): string {
  const lines = [
    `Messages: ${status.messageCount}`,
    `DOM nodes: ${status.domNodeCount.toLocaleString()}`,
  ];
  if (status.isSupported) {
    lines.push(`Heap: ${formatBytes(status.heapUsed)} / ${formatBytes(status.heapLimit)} (${status.usagePercent.toFixed(1)}%)`);
  }
  lines.push(`Pressure: ${status.pressure}`);
  return lines.join('\n');
}
