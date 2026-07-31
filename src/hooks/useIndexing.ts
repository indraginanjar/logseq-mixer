import { useEffect, useRef, useState } from 'react';
import type { IndexingResult } from 'indexManager';
import {
  cancelAutoIndexDebounce,
  getIndexingProgress,
  isIndexingActive,
  requestPauseIndexing,
  setAutoEmbedEnabled as setAutoEmbedEnabledIM,
  setAutoIndexDebounceSeconds,
} from 'indexManager';
import { enableAutoIndexer, indexEntireLogSeq } from 'manager';
import { cancelCooldown, startCooldown } from '../cooldownManager';
import type { StorageProvider } from '../storage/StorageProvider';

interface Settings {
  autoIndexDebounceSeconds?: number;
  [key: string]: any;
}

export function useIndexing(
  storageProvider: StorageProvider,
  settings: Settings | null,
  isVisible: boolean
) {
  const [isIndexing, setIsIndexing] = useState(isIndexingActive());
  const [indexingStatus, setIndexingStatus] = useState<IndexingResult | null>(null);
  const [isDismissing, setIsDismissing] = useState(false);
  const [progressCount, setProgressCount] = useState(getIndexingProgress);
  const [autoEmbedEnabled, setAutoEmbedEnabled] = useState(() => (logseq.settings?.autoEmbedEnabled as boolean) ?? true);
  const [cooldownActive, setCooldownActive] = useState(false);
  const [docCount, setDocCount] = useState<number | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [dbSize, setDbSize] = useState<number | null>(null);
  const manualIndexingRef = useRef(false);
  const [confirmClearDb, setConfirmClearDb] = useState(false);

  // Poll document, page count, and database size every 10 seconds
  useEffect(() => {
    const fetchCount = async () => {
      if (storageProvider.getDocumentCount) {
        try {
          const count = await storageProvider.getDocumentCount();
          setDocCount(count);
        } catch { /* ignore */ }
      }
      if (storageProvider.getPageCount) {
        try {
          const count = await storageProvider.getPageCount();
          setPageCount(count);
        } catch { /* ignore */ }
      }
      if (storageProvider.getDatabaseSize) {
        try {
          const size = await storageProvider.getDatabaseSize();
          setDbSize(size);
        } catch { /* ignore */ }
      }
    };
    fetchCount();
    const interval = setInterval(fetchCount, 10000);
    return () => clearInterval(interval);
  }, [storageProvider]);

  // Enable auto indexer when settings change
  useEffect(() => {
    if (settings) {
      enableAutoIndexer(settings, storageProvider);
      // Sync configurable debounce delay from settings
      const debounce = settings.autoIndexDebounceSeconds;
      if (typeof debounce === 'number' && debounce > 0) {
        setAutoIndexDebounceSeconds(debounce);
      }
    }
  }, [settings]);

  // Auto-dismiss success status after 4 seconds
  useEffect(() => {
    if (indexingStatus?.outcome !== 'completed') return;
    const timer = setTimeout(() => {
      setIsDismissing(true);
      // Remove from DOM after animation completes
      setTimeout(() => { setIndexingStatus(null); setIsDismissing(false); }, 200);
    }, 4000);
    return () => clearTimeout(timer);
  }, [indexingStatus]);

  // Poll indexing progress every 500ms while indexing is active.
  // Also detects when auto-indexer finishes (isIndexingActive becomes false).
  useEffect(() => {
    if (!isIndexing) return;
    const interval = setInterval(() => {
      setProgressCount(getIndexingProgress());
      // Detect auto-indexer completion
      if (!manualIndexingRef.current && !isIndexingActive()) {
        setIsIndexing(false);
      }
    }, 500);
    return () => clearInterval(interval);
  }, [isIndexing]);

  // Detect auto-indexer activity: poll isIndexingActive() to sync the
  // React isIndexing state with the module-level indexingInProgress flag.
  // Polls every 1s when the panel is visible and not during manual indexing.
  useEffect(() => {
    if (!isVisible) return;
    const interval = setInterval(() => {
      if (manualIndexingRef.current) return;
      const active = isIndexingActive();
      setIsIndexing(prev => {
        if (active && !prev) return true;
        return prev;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [isVisible]);

  // Cancel cooldown timer on unmount
  useEffect(() => {
    return () => { cancelCooldown(); };
  }, []);

  const handleIndexDB = async () => {
    if (isIndexing) {
      requestPauseIndexing();
      cancelAutoIndexDebounce();
      startCooldown(() => setCooldownActive(false));
      setCooldownActive(true);
      return;
    }
    if (cooldownActive) return;
    manualIndexingRef.current = true;
    setIsIndexing(true);
    setIndexingStatus(null);
    setIsDismissing(false);

    try {
      const result = await indexEntireLogSeq(settings, storageProvider);
      if (result.outcome === 'error') {
        return result.errorMessage || 'Indexing failed.';
      } else {
        setIndexingStatus(result);
      }
    } catch (err: any) {
      return err.message || 'Indexing failed.';
    } finally {
      setIsIndexing(false);
      manualIndexingRef.current = false;
    }
    return null;
  };

  const handleAutoEmbedToggle = () => {
    const newValue = !autoEmbedEnabled;
    setAutoEmbedEnabled(newValue);
    setAutoEmbedEnabledIM(newValue);
    logseq.updateSettings({ autoEmbedEnabled: newValue });
    // When disabling auto-embed, also stop any in-progress auto-indexing
    // and cancel pending debounce timers so the user gets immediate feedback
    if (!newValue && isIndexing && !manualIndexingRef.current) {
      requestPauseIndexing();
      cancelAutoIndexDebounce();
    }
  };

  return {
    isIndexing,
    indexingStatus,
    isDismissing,
    progressCount,
    autoEmbedEnabled,
    cooldownActive,
    docCount,
    setDocCount,
    pageCount,
    setPageCount,
    dbSize,
    setDbSize,
    confirmClearDb,
    setConfirmClearDb,
    handleIndexDB,
    handleAutoEmbedToggle,
  };
}
