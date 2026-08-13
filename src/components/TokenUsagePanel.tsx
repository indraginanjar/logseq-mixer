import React, { useEffect, useState } from 'react';
import { styled, keyframes } from '../stitches.config';
import type { TokenUsageAggregate } from '../storage/TokenUsageStore';
import { getTokenUsageStore } from '../storage/tokenUsageInstance';

// --- Utilities ---

function formatNumber(n: number): string {
  return n.toLocaleString();
}

function formatMonthLabel(periodLabel: string): string {
  // periodLabel is "YYYY-MM" → "Aug 2026"
  const [year, month] = periodLabel.split('-');
  const date = new Date(parseInt(year), parseInt(month) - 1);
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function formatWeekLabel(periodLabel: string): string {
  // periodLabel is "YYYY-Www" → "Week 33, 2026"
  const match = periodLabel.match(/^(\d{4})-W(\d{2})$/);
  if (!match) return periodLabel;
  return `Week ${parseInt(match[2])}, ${match[1]}`;
}

// --- Animations ---

const fadeIn = keyframes({ '0%': { opacity: 0 }, '100%': { opacity: 1 } });
const slideDown = keyframes({ '0%': { opacity: 0, transform: 'translateY(-4px)' }, '100%': { opacity: 1, transform: 'translateY(0)' } });

// --- Styled Components ---

const PanelContainer = styled('div', {
  position: 'absolute',
  top: '53px',
  left: 0,
  right: 0,
  bottom: 0,
  boxSizing: 'border-box',
  backgroundColor: '$elevation0',
  zIndex: 10,
  display: 'flex',
  flexDirection: 'column',
  padding: '24px 20px',
  animation: `${fadeIn} 0.2s ease-out`,
  overflow: 'hidden',
});

const PanelHeader = styled('div', {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: '16px',
  borderBottom: '1px solid $slate6',
  paddingBottom: '10px',
  flexShrink: 0,
});

const PanelTitle = styled('h3', {
  margin: 0,
  fontSize: '16px',
  fontWeight: 600,
  color: '$highContrast',
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
});

const HeaderButtons = styled('div', {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
});

const HeaderButton = styled('button', {
  background: 'none',
  border: '1px solid $slate6',
  borderRadius: '4px',
  fontSize: '11px',
  color: '$slate11',
  cursor: 'pointer',
  padding: '4px 8px',
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
  '&:hover': {
    backgroundColor: '$slate4',
    color: '$highContrast',
    borderColor: '$slate8',
  },
});

const CloseButton = styled('button', {
  background: 'none',
  border: 'none',
  fontSize: '16px',
  color: '$slate11',
  cursor: 'pointer',
  padding: '4px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '4px',
  '&:hover': {
    backgroundColor: '$slate4',
    color: '$highContrast',
  },
});

const TabBar = styled('div', {
  display: 'flex',
  gap: '6px',
  marginBottom: '16px',
  flexWrap: 'wrap',
  flexShrink: 0,
});

const TabPill = styled('button', {
  border: 'none',
  borderRadius: '12px',
  fontSize: '11px',
  fontWeight: 500,
  padding: '4px 10px',
  cursor: 'pointer',
  transition: 'all 0.15s',
  variants: {
    active: {
      true: { backgroundColor: '$blue9', color: 'white' },
      false: { backgroundColor: '$slate3', color: '$slate11', '&:hover': { backgroundColor: '$slate4' } },
    },
  },
});

const SummaryCard = styled('div', {
  border: '1px solid $slate5',
  borderRadius: '10px',
  backgroundColor: '$slate2',
  padding: '16px',
  marginBottom: '16px',
  flexShrink: 0,
  animation: `${slideDown} 0.15s ease-out both`,
});

const SummaryTitle = styled('div', {
  fontSize: '12px',
  fontWeight: 600,
  color: '$slate10',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  marginBottom: '12px',
});

const SummaryGrid = styled('div', {
  display: 'grid',
  gridTemplateColumns: 'repeat(4, 1fr)',
  gap: '12px',
});

const SummaryStat = styled('div', {
  display: 'flex',
  flexDirection: 'column',
  gap: '2px',
});

const StatValue = styled('span', {
  fontSize: '18px',
  fontWeight: 700,
  color: '$highContrast',
});

const StatLabel = styled('span', {
  fontSize: '10px',
  color: '$slate10',
  textTransform: 'uppercase',
});

const ScrollableArea = styled('div', {
  flex: 1,
  height: 0,
  overflowY: 'scroll',
  paddingRight: '4px',
  boxSizing: 'border-box',
  '&::-webkit-scrollbar': { width: '6px' },
  '&::-webkit-scrollbar-track': { background: 'transparent' },
  '&::-webkit-scrollbar-thumb': { backgroundColor: '$slate8', borderRadius: '3px' },
});

const DataTable = styled('table', {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '12px',
});

const TableHeader = styled('thead', {
  position: 'sticky',
  top: 0,
  backgroundColor: '$elevation0',
  zIndex: 1,
});

const TableHeaderCell = styled('th', {
  textAlign: 'left',
  padding: '8px 10px',
  fontSize: '10px',
  fontWeight: 600,
  color: '$slate10',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  borderBottom: '1px solid $slate5',
});

const TableRow = styled('tr', {
  borderBottom: '1px solid $slate4',
  '&:hover': { backgroundColor: '$slate3' },
  transition: 'background-color 0.1s',
});

const TableCell = styled('td', {
  padding: '8px 10px',
  fontSize: '12px',
  color: '$highContrast',
  fontVariantNumeric: 'tabular-nums',
});

const EmptyState = styled('div', {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '13px',
  color: '$slate10',
  textAlign: 'center',
  padding: '20px',
});

const ConfirmBar = styled('div', {
  marginTop: '6px',
  padding: '8px 12px',
  backgroundColor: '$red3',
  borderRadius: '6px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  fontSize: '11px',
  color: '$red11',
  gap: '8px',
});

const ConfirmButton = styled('button', {
  fontSize: '11px',
  padding: '4px 10px',
  borderRadius: '4px',
  cursor: 'pointer',
  fontWeight: 500,
  border: 'none',
  variants: {
    variant: {
      danger: { backgroundColor: '$red9', color: 'white', '&:hover': { backgroundColor: '$red10' } },
      cancel: { backgroundColor: 'transparent', border: '1px solid $slate6', color: '$slate11', '&:hover': { backgroundColor: '$slate4' } },
    },
  },
});

// --- Types ---

type TabType = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'alltime';

const TABS: { label: string; value: TabType }[] = [
  { label: 'Daily', value: 'daily' },
  { label: 'Weekly', value: 'weekly' },
  { label: 'Monthly', value: 'monthly' },
  { label: 'Yearly', value: 'yearly' },
  { label: 'All Time', value: 'alltime' },
];

// --- Props ---

interface TokenUsagePanelProps {
  onClose: () => void;
}

// --- Component ---

export default function TokenUsagePanel({ onClose }: TokenUsagePanelProps) {
  const [activeTab, setActiveTab] = useState<TabType>('daily');
  const [data, setData] = useState<TokenUsageAggregate[]>([]);
  const [allTimeTotals, setAllTimeTotals] = useState<TokenUsageAggregate>({
    periodLabel: 'all',
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    callCount: 0,
  });
  const [confirmClear, setConfirmClear] = useState(false);

  const store = getTokenUsageStore();

  const loadData = () => {
    if (!store) return;

    // Always load all-time totals for the summary card
    setAllTimeTotals(store.getAllTime());

    // Load tab-specific data
    switch (activeTab) {
      case 'daily':
        setData(store.getDaily());
        break;
      case 'weekly':
        setData(store.getWeekly(12));
        break;
      case 'monthly':
        setData(store.getMonthly(12));
        break;
      case 'yearly':
        setData(store.getYearly());
        break;
      case 'alltime':
        setData([store.getAllTime()]);
        break;
    }
  };

  useEffect(() => {
    loadData();
  }, [store, activeTab]);

  useEffect(() => {
    const handleKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleClearAll = () => {
    if (!store) return;
    store.deleteAll();
    setConfirmClear(false);
    loadData();
  };

  const formatPeriodLabel = (label: string): string => {
    switch (activeTab) {
      case 'monthly':
        return formatMonthLabel(label);
      case 'weekly':
        return formatWeekLabel(label);
      case 'alltime':
        return 'All Time';
      default:
        return label;
    }
  };

  // Handle store not available
  if (!store) {
    return (
      <PanelContainer>
        <PanelHeader>
          <PanelTitle>📊 Token Usage</PanelTitle>
          <HeaderButtons>
            <CloseButton onClick={onClose} aria-label="Close Token Usage Panel">✕</CloseButton>
          </HeaderButtons>
        </PanelHeader>
        <EmptyState>
          Token usage tracking not available. Please index your notes first.
        </EmptyState>
      </PanelContainer>
    );
  }

  return (
    <PanelContainer>
      <PanelHeader>
        <PanelTitle>📊 Token Usage</PanelTitle>
        <HeaderButtons>
          {!confirmClear ? (
            <HeaderButton onClick={() => setConfirmClear(true)}>🗑️ Clear All</HeaderButton>
          ) : (
            <ConfirmBar>
              <span>Delete all usage data?</span>
              <div style={{ display: 'flex', gap: '6px' }}>
                <ConfirmButton variant="danger" onClick={handleClearAll}>Yes, clear</ConfirmButton>
                <ConfirmButton variant="cancel" onClick={() => setConfirmClear(false)}>Cancel</ConfirmButton>
              </div>
            </ConfirmBar>
          )}
          <CloseButton onClick={onClose} aria-label="Close Token Usage Panel">✕</CloseButton>
        </HeaderButtons>
      </PanelHeader>

      {/* Summary Card */}
      <SummaryCard>
        <SummaryTitle>All-Time Totals</SummaryTitle>
        <SummaryGrid>
          <SummaryStat>
            <StatValue>{formatNumber(allTimeTotals.promptTokens)}</StatValue>
            <StatLabel>Input Tokens</StatLabel>
          </SummaryStat>
          <SummaryStat>
            <StatValue>{formatNumber(allTimeTotals.completionTokens)}</StatValue>
            <StatLabel>Output Tokens</StatLabel>
          </SummaryStat>
          <SummaryStat>
            <StatValue>{formatNumber(allTimeTotals.totalTokens)}</StatValue>
            <StatLabel>Total Tokens</StatLabel>
          </SummaryStat>
          <SummaryStat>
            <StatValue>{formatNumber(allTimeTotals.callCount)}</StatValue>
            <StatLabel>API Calls</StatLabel>
          </SummaryStat>
        </SummaryGrid>
      </SummaryCard>

      {/* Tab Bar */}
      <TabBar>
        {TABS.map(t => (
          <TabPill key={t.value} active={activeTab === t.value} onClick={() => setActiveTab(t.value)}>
            {t.label}
          </TabPill>
        ))}
      </TabBar>

      {/* Data Table */}
      {data.length === 0 ? (
        <EmptyState>
          No usage data yet. Start chatting with the assistant to track token usage.
        </EmptyState>
      ) : (
        <ScrollableArea>
          <DataTable>
            <TableHeader>
              <tr>
                <TableHeaderCell>Period</TableHeaderCell>
                <TableHeaderCell>Input Tokens</TableHeaderCell>
                <TableHeaderCell>Output Tokens</TableHeaderCell>
                <TableHeaderCell>Total Tokens</TableHeaderCell>
                <TableHeaderCell>API Calls</TableHeaderCell>
              </tr>
            </TableHeader>
            <tbody>
              {data.map((row, idx) => (
                <TableRow key={`${row.periodLabel}-${idx}`}>
                  <TableCell>{formatPeriodLabel(row.periodLabel)}</TableCell>
                  <TableCell>{formatNumber(row.promptTokens)}</TableCell>
                  <TableCell>{formatNumber(row.completionTokens)}</TableCell>
                  <TableCell>{formatNumber(row.totalTokens)}</TableCell>
                  <TableCell>{formatNumber(row.callCount)}</TableCell>
                </TableRow>
              ))}
            </tbody>
          </DataTable>
        </ScrollableArea>
      )}
    </PanelContainer>
  );
}
