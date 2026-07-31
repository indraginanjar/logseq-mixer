import React from 'react';
import { keyframes, styled } from '../stitches.config';
import type { StorageProvider } from '../storage/StorageProvider';

// --- Utilities ---

function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// --- Animations ---

const fadeIn = keyframes({
  '0%': { opacity: 0, transform: 'translateY(-4px)' },
  '100%': { opacity: 1, transform: 'translateY(0)' },
});

// --- Styled Components ---

const PanelCloseButton = styled('button', {
  background: 'transparent',
  border: 'none',
  width: '28px',
  height: '28px',
  borderRadius: '6px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  color: '$slate9',
  fontSize: '14px',
  transition: 'all 0.15s',
  '&:hover': { backgroundColor: '$slate3', color: '$highContrast' },
});

const DbPanel = styled('div', {
  position: 'absolute',
  top: '53px',
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: '$elevation0',
  zIndex: 10,
  display: 'flex',
  flexDirection: 'column',
  padding: '24px 20px',
  animation: `${fadeIn} 0.2s ease-out`,
});

const DbPanelHeader = styled('div', {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: '20px',
  borderBottom: '1px solid $slate6',
  paddingBottom: '10px',
});

const DbPanelTitle = styled('h3', {
  margin: 0,
  fontSize: '16px',
  fontWeight: 600,
  color: '$highContrast',
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
});

const DbStatsList = styled('div', {
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
  flex: 1,
  overflowY: 'auto',
});

const DbStatRow = styled('div', {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '10px 12px',
  backgroundColor: '$slate3',
  borderRadius: '8px',
  border: '1px solid $slate5',
});

const DbStatLabel = styled('span', {
  fontSize: '13px',
  fontWeight: 500,
  color: '$slate11',
});

const DbStatValue = styled('span', {
  fontSize: '13px',
  fontWeight: 600,
  color: '$highContrast',
});

const DbPanelActions = styled('div', {
  display: 'flex',
  gap: '10px',
  marginTop: '20px',
});

const DbPanelButton = styled('button', {
  flex: 1,
  padding: '10px 16px',
  borderRadius: '8px',
  fontSize: '13px',
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'all 0.15s',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '6px',
  fontFamily: '$sans',
  variants: {
    variant: {
      primary: {
        backgroundColor: '$blue9',
        color: 'white',
        border: 'none',
        '&:hover': { backgroundColor: '$blue10' },
        '&:active': { transform: 'scale(0.98)' },
      },
      secondary: {
        backgroundColor: 'transparent',
        border: '1px solid $slate6',
        color: '$slate11',
        '&:hover': { backgroundColor: '$slate3', color: '$highContrast' },
        '&:active': { transform: 'scale(0.98)' },
      },
    },
  },
  defaultVariants: {
    variant: 'secondary',
  },
});

// --- Props ---

interface DatabasePanelProps {
  storageProvider: StorageProvider;
  settings: any;
  docCount: number | null;
  pageCount: number | null;
  dbSize: number | null;
  confirmClearDb: boolean;
  setConfirmClearDb: (v: boolean) => void;
  setDocCount: (v: number) => void;
  setPageCount: (v: number) => void;
  setDbSize: (v: number) => void;
  fileInputRef: React.RefObject<HTMLInputElement>;
  onImportFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClose: () => void;
}

// --- Component ---

export function DatabasePanel({
  storageProvider,
  settings,
  docCount,
  pageCount,
  dbSize,
  confirmClearDb,
  setConfirmClearDb,
  setDocCount,
  setPageCount,
  setDbSize,
  fileInputRef,
  onImportFileChange,
  onClose,
}: DatabasePanelProps) {
  return (
    <DbPanel>
      <DbPanelHeader>
        <DbPanelTitle>&#x1F5C4;&#xFE0F; Database Center</DbPanelTitle>
        <PanelCloseButton onClick={onClose} aria-label="Close Database Panel">&#x2715;</PanelCloseButton>
      </DbPanelHeader>

      <DbStatsList>
        {dbSize !== null && (
          <DbStatRow>
            <DbStatLabel>Database Size</DbStatLabel>
            <DbStatValue>{formatBytes(dbSize)}</DbStatValue>
          </DbStatRow>
        )}
        <DbStatRow>
          <DbStatLabel>Indexed Pages</DbStatLabel>
          <DbStatValue>
            {pageCount !== null ? pageCount.toLocaleString() : '0'}
          </DbStatValue>
        </DbStatRow>
        <DbStatRow>
          <DbStatLabel>Indexed Chunks (Vectors)</DbStatLabel>
          <DbStatValue>
            {docCount !== null ? docCount.toLocaleString() : '0'}
          </DbStatValue>
        </DbStatRow>
        <DbStatRow>
          <DbStatLabel>Embedding Provider</DbStatLabel>
          <DbStatValue style={{ textTransform: 'capitalize' }}>
            {settings?.embeddingProvider || 'OpenAI'}
          </DbStatValue>
        </DbStatRow>
        <DbStatRow>
          <DbStatLabel>Embedding Model</DbStatLabel>
          <DbStatValue>
            {settings?.embeddingModel || 'text-embedding-3-small'}
          </DbStatValue>
        </DbStatRow>
      </DbStatsList>

      <DbPanelActions>
        {storageProvider.exportToFile && (
          <DbPanelButton variant="primary" onClick={() => storageProvider.exportToFile?.()}>
            &#x1F4E4; Export SQLite DB
          </DbPanelButton>
        )}
        {storageProvider.importFromFile && (
          <>
            <input
              type="file"
              accept=".sqlite,.db"
              ref={fileInputRef}
              onChange={onImportFileChange}
              style={{ display: 'none' }}
            />
            <DbPanelButton variant="primary" onClick={() => fileInputRef.current?.click()}>
              &#x1F4E5; Import SQLite DB
            </DbPanelButton>
          </>
        )}
        <DbPanelButton variant="secondary" onClick={onClose}>
          Close
        </DbPanelButton>
        {!confirmClearDb ? (
          <DbPanelButton variant="secondary" title="Clear all indexed data" onClick={() => setConfirmClearDb(true)} css={{ borderColor: '$red7', color: '$red11', '&:hover': { backgroundColor: '$red3', borderColor: '$red8', color: '$red11' } }}>
            &#x1F5D1;&#xFE0F; Clear Database
          </DbPanelButton>
        ) : (
          <div style={{ display: 'flex', flex: 1, gap: '6px', alignItems: 'center', backgroundColor: '#fee2e2', padding: '8px 12px', borderRadius: '8px', border: '1px solid #fca5a5' }}>
            <span style={{ fontSize: '12px', color: '#991b1b', flex: 1 }}>Delete all indexed data?</span>
            <DbPanelButton variant="secondary" onClick={async () => {
              try {
                await storageProvider.clear();
                setDocCount(0);
                setPageCount(0);
                if (storageProvider.getDatabaseSize) setDbSize(await storageProvider.getDatabaseSize());
                window.logseq.UI.showMsg('Database cleared successfully. Please re-index.', 'success');
              } catch (err: any) {
                window.logseq.UI.showMsg(`Failed to clear database: ${err.message}`, 'error');
              }
              setConfirmClearDb(false);
            }} css={{ borderColor: '$red7', color: 'white', backgroundColor: '$red9', '&:hover': { backgroundColor: '$red10' }, flex: 'none' }}>
              Yes, clear
            </DbPanelButton>
            <DbPanelButton variant="secondary" onClick={() => setConfirmClearDb(false)} css={{ flex: 'none' }}>
              Cancel
            </DbPanelButton>
          </div>
        )}
      </DbPanelActions>
    </DbPanel>
  );
}

export default DatabasePanel;
