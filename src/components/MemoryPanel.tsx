import React, { useEffect, useState } from 'react';
import { styled, keyframes } from '../stitches.config';
import type { MemoryStore, MemoryEntry } from '../memory/MemoryStore';

const fadeIn = keyframes({ '0%': { opacity: 0 }, '100%': { opacity: 1 } });
const slideDown = keyframes({ '0%': { opacity: 0, transform: 'translateY(-4px)' }, '100%': { opacity: 1, transform: 'translateY(0)' } });

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

const TabRow = styled('div', {
  display: 'flex',
  gap: '6px',
  marginBottom: '12px',
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

const ScrollableArea = styled('div', {
  flex: 1,
  height: 0,
  overflowY: 'scroll',
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
  paddingRight: '4px',
  boxSizing: 'border-box',
  '&::-webkit-scrollbar': { width: '6px' },
  '&::-webkit-scrollbar-track': { background: 'transparent' },
  '&::-webkit-scrollbar-thumb': { backgroundColor: '$slate8', borderRadius: '3px' },
});

const MemoryCard = styled('div', {
  border: '1px solid $slate5',
  borderRadius: '8px',
  backgroundColor: '$slate2',
  padding: '10px 12px',
  animation: `${slideDown} 0.15s ease-out both`,
});

const CardTop = styled('div', {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '8px',
});

const Badge = styled('span', {
  fontSize: '10px',
  fontWeight: 600,
  borderRadius: '4px',
  padding: '2px 6px',
  textTransform: 'uppercase',
  variants: {
    cat: {
      preference: { backgroundColor: '$blue3', color: '$blue11' },
      fact: { backgroundColor: '$green3', color: '$green11' },
      session_summary: { backgroundColor: '$amber3', color: '$amber11' },
      task: { backgroundColor: '$purple3', color: '$purple11' },
    },
  },
});

const ContentText = styled('p', {
  margin: '6px 0 4px',
  fontSize: '12px',
  color: '$highContrast',
  lineHeight: 1.4,
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
});

const CardMeta = styled('div', {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  fontSize: '10px',
  color: '$slate10',
});

const ActionButtons = styled('div', {
  display: 'flex',
  gap: '4px',
});

const IconBtn = styled('button', {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  fontSize: '12px',
  padding: '2px 4px',
  borderRadius: '4px',
  '&:hover': { backgroundColor: '$slate4' },
});

const EditArea = styled('div', {
  marginTop: '8px',
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
});

const EditTextarea = styled('textarea', {
  width: '100%',
  minHeight: '60px',
  fontSize: '12px',
  padding: '8px',
  border: '1px solid $slate6',
  borderRadius: '6px',
  backgroundColor: '$elevation1',
  color: '$highContrast',
  resize: 'vertical',
  outline: 'none',
  fontFamily: 'inherit',
  '&:focus': { borderColor: '$blue9' },
});

const EditActions = styled('div', {
  display: 'flex',
  gap: '6px',
  justifyContent: 'flex-end',
});

const SmallBtn = styled('button', {
  fontSize: '11px',
  padding: '4px 10px',
  borderRadius: '4px',
  cursor: 'pointer',
  fontWeight: 500,
  variants: {
    variant: {
      save: { backgroundColor: '$blue9', color: 'white', border: 'none', '&:hover': { backgroundColor: '$blue10' } },
      cancel: { backgroundColor: 'transparent', border: '1px solid $slate6', color: '$slate11', '&:hover': { backgroundColor: '$slate4' } },
      yes: { backgroundColor: '$red9', color: 'white', border: 'none', '&:hover': { backgroundColor: '$red10' } },
      no: { backgroundColor: 'transparent', border: '1px solid $slate6', color: '$slate11', '&:hover': { backgroundColor: '$slate4' } },
    },
  },
});

const DeleteBar = styled('div', {
  marginTop: '6px',
  padding: '6px 8px',
  backgroundColor: '$red3',
  borderRadius: '6px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  fontSize: '11px',
  color: '$red11',
});

const EmptyState = styled('div', {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '13px',
  color: '$slate10',
});

const DisabledOverlay = styled('div', {
  position: 'absolute',
  inset: 0,
  backgroundColor: 'rgba(0,0,0,0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 11,
  borderRadius: '8px',
});

const DisabledNotice = styled('div', {
  backgroundColor: '$elevation0',
  padding: '20px 24px',
  borderRadius: '10px',
  fontSize: '13px',
  color: '$highContrast',
  textAlign: 'center',
  border: '1px solid $slate6',
});

type Category = 'all' | 'preference' | 'fact' | 'session_summary' | 'task';
const TABS: { label: string; value: Category }[] = [
  { label: 'All', value: 'all' },
  { label: 'Preferences', value: 'preference' },
  { label: 'Facts', value: 'fact' },
  { label: 'Sessions', value: 'session_summary' },
  { label: 'Tasks', value: 'task' },
];

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} hours ago`;
  return `${Math.floor(diff / 86_400_000)} days ago`;
}

interface MemoryPanelProps {
  onClose: () => void;
  memoryStore: MemoryStore | null;
  memoryEnabled: boolean;
  onCountChange?: (count: number) => void;
}

export default function MemoryPanel({ onClose, memoryStore, memoryEnabled, onCountChange }: MemoryPanelProps) {
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [activeTab, setActiveTab] = useState<Category>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadMemories = () => {
    if (!memoryStore) return;
    const filter = activeTab === 'all' ? undefined : { category: activeTab };
    setMemories(memoryStore.getMemories(filter));
  };

  useEffect(() => { loadMemories(); }, [memoryStore, activeTab]);

  useEffect(() => {
    const handleKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const notifyCount = () => {
    if (!memoryStore || !onCountChange) return;
    onCountChange(memoryStore.getMemoryCount());
  };

  const handleSaveEdit = (id: string) => {
    if (!memoryStore) return;
    memoryStore.updateMemory(id, editText);
    setEditingId(null);
    loadMemories();
    notifyCount();
  };

  const handleDelete = (id: string) => {
    if (!memoryStore) return;
    memoryStore.deleteMemory(id);
    setDeletingId(null);
    loadMemories();
    notifyCount();
  };

  const handleClearAll = () => {
    if (!memoryStore) return;
    if (window.confirm('Are you sure you want to delete ALL memories? This cannot be undone.')) {
      memoryStore.deleteAll();
      loadMemories();
      notifyCount();
    }
  };

  return (
    <PanelContainer>
      {!memoryEnabled && (
        <DisabledOverlay>
          <DisabledNotice>🧠 Memory is disabled.<br />Enable it in plugin settings to use this feature.</DisabledNotice>
        </DisabledOverlay>
      )}
      <PanelHeader>
        <PanelTitle>🧠 Memory Manager</PanelTitle>
        <HeaderButtons>
          <HeaderButton onClick={handleClearAll}>🗑️ Clear All</HeaderButton>
          <CloseButton onClick={onClose} aria-label="Close Memory Panel">✕</CloseButton>
        </HeaderButtons>
      </PanelHeader>

      <TabRow>
        {TABS.map(t => (
          <TabPill key={t.value} active={activeTab === t.value} onClick={() => setActiveTab(t.value)}>
            {t.label}
          </TabPill>
        ))}
      </TabRow>

      {memories.length === 0 ? (
        <EmptyState>No memories yet. Chat with the assistant to start building memory.</EmptyState>
      ) : (
        <ScrollableArea>
          {memories.map(mem => (
            <MemoryCard key={mem.id}>
              <CardTop>
                <Badge cat={mem.category as any}>{mem.category.replace('_', ' ')}</Badge>
                <ActionButtons>
                  <IconBtn onClick={() => { setEditingId(mem.id); setEditText(mem.content); setDeletingId(null); }} title="Edit">✏️</IconBtn>
                  <IconBtn onClick={() => { setDeletingId(mem.id); setEditingId(null); }} title="Delete">🗑️</IconBtn>
                </ActionButtons>
              </CardTop>
              {editingId === mem.id ? (
                <EditArea>
                  <EditTextarea value={editText} onChange={e => setEditText(e.target.value)} />
                  <EditActions>
                    <SmallBtn variant="cancel" onClick={() => setEditingId(null)}>Cancel</SmallBtn>
                    <SmallBtn variant="save" onClick={() => handleSaveEdit(mem.id)}>Save</SmallBtn>
                  </EditActions>
                </EditArea>
              ) : (
                <ContentText>{mem.content}</ContentText>
              )}
              {deletingId === mem.id && (
                <DeleteBar>
                  <span>Delete this memory?</span>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <SmallBtn variant="yes" onClick={() => handleDelete(mem.id)}>Yes</SmallBtn>
                    <SmallBtn variant="no" onClick={() => setDeletingId(null)}>No</SmallBtn>
                  </div>
                </DeleteBar>
              )}
              <CardMeta>
                <span>{relativeTime(mem.createdAt)}</span>
                {mem.source && <span>· {mem.source}</span>}
              </CardMeta>
            </MemoryCard>
          ))}
        </ScrollableArea>
      )}
    </PanelContainer>
  );
}
