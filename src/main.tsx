import '@logseq/libs';
import React from 'react';
import ReactDOM from 'react-dom';
import { RecoilRoot } from 'recoil';
import 'VectorDBManager';
import App from './App';
import settings from './settings';
import { createStorageProvider } from './storage/createStorageProvider';
import type { StorageProvider } from './storage/StorageProvider';
import { ensureInitialized as ensureTokenizerReady } from './tokenizer';

/**
 * Lazy storage provider wrapper. Defers the heavy SQLite WASM initialization
 * until the first method call (typically when the user opens the chat panel
 * or the auto-indexer fires). This prevents blocking Logseq's main thread
 * during startup, which causes "Not Responding" on Windows.
 */
function createLazyStorageProvider(backend: 'sqlite' | 'settings'): StorageProvider {
  let realProvider: StorageProvider | null = null;
  let initPromise: Promise<StorageProvider> | null = null;

  async function getProvider(): Promise<StorageProvider> {
    if (realProvider) return realProvider;
    if (!initPromise) {
      initPromise = (async () => {
        // Initialize the tokenizer (loads ~1.5 MB cl100k_base encoding table)
        await ensureTokenizerReady();
        const p = await createStorageProvider(backend);
        realProvider = p;
        return p;
      })();
    }
    return initPromise;
  }

  /** Reinitialize storage for a new graph (called on graph switch). */
  async function reinitialize(): Promise<void> {
    realProvider = null;
    initPromise = null;
    await getProvider();
  }

  // Start initialization when the browser is idle, with a fallback timeout.
  // requestIdleCallback ensures we only parse the heavy 1.25 MB indexManager
  // chunk when the main thread has nothing else to do.
  const scheduleInit = typeof requestIdleCallback === 'function'
    ? () => requestIdleCallback(() => { getProvider().catch(console.error); }, { timeout: 10000 })
    : () => setTimeout(() => { getProvider().catch(console.error); }, 5000);
  scheduleInit();

  const proxy: StorageProvider = {
    async clear() {
      const p = await getProvider();
      return p.clear();
    },
  };

  // Proxy all optional methods so they resolve lazily
  const optionalAsyncMethods = [
    'upsertDocuments', 'deleteDocuments', 'searchByVector',
    'getDocumentMeta', 'save', 'load', 'importFromFile', 'getDatabaseSize',
  ] as const;

  for (const method of optionalAsyncMethods) {
    (proxy as any)[method] = async (...args: any[]) => {
      const p = await getProvider();
      const fn = (p as any)[method];
      return fn ? fn.apply(p, args) : undefined;
    };
  }

  // Proxy sync/optional methods that need the real provider
  const optionalSyncMethods = [
    'exportToFile', 'beginBulk', 'endBulk',
    'upsertBlockMetadata', 'deleteBlockMetadataForPage',
    'clearBlockMetadata', 'getBlockMetadata',
  ] as const;

  for (const method of optionalSyncMethods) {
    (proxy as any)[method] = (...args: any[]) => {
      if (!realProvider) {
        console.warn(`[LazyStorageProvider] ${method} called before initialization`);
        return undefined;
      }
      const fn = (realProvider as any)[method];
      return fn ? fn.apply(realProvider, args) : undefined;
    };
  }

  // Proxy async count methods
  (proxy as any).getDocumentCount = async () => {
    const p = await getProvider();
    return (p as any).getDocumentCount?.() ?? 0;
  };
  (proxy as any).getPageCount = async () => {
    const p = await getProvider();
    return (p as any).getPageCount?.() ?? 0;
  };
  (proxy as any).persistToIndexedDB = async () => {
    const p = await getProvider();
    return (p as any).persistToIndexedDB?.();
  };
  (proxy as any).getAllDocumentContent = () => {
    if (!realProvider) return [];
    return (realProvider as any).getAllDocumentContent?.() ?? [];
  };
  // Expose reinitialize for graph switching
  (proxy as any).reinitialize = reinitialize;
  // Expose db getter for MemoryStore
  Object.defineProperty(proxy, 'db', {
    get() { return (realProvider as any)?.db ?? null; },
  });

  return proxy;
}

async function main() {
  const key = logseq.baseInfo.id;
  console.info(`${key}: MAIN`);

  // Create a lazy storage provider that defers heavy SQLite initialization
  const storageBackend = (logseq.settings?.storageBackend as 'sqlite' | 'settings') ?? 'sqlite';
  const storageProvider = createLazyStorageProvider(storageBackend);

  // Reinitialize storage when user switches graphs
  logseq.App.onCurrentGraphChanged(async () => {
    console.info('[main] Graph changed, reinitializing storage provider...');
    await (storageProvider as any).reinitialize();
  });

  const { preferredThemeMode } = await logseq.App.getUserConfigs();

  ReactDOM.render(
    <React.StrictMode>
      <RecoilRoot>
        <App themeMode={preferredThemeMode} storageProvider={storageProvider} />
      </RecoilRoot>
    </React.StrictMode>,
    document.getElementById('root'),
  );

  logseq.provideModel({
    show() {
      logseq.showMainUI();

      setTimeout(() => {
        const container = document.getElementById("messages-container");
        if (container) {
          container.scrollTop = container.scrollHeight;
        } else {
          console.warn("Messages container not found.");
        }
      }, 300);
    },
  });

  logseq.setMainUIInlineStyle({
    position: 'fixed',
    zIndex: 11,
  });

  const toolbarButtonKey = 'logseq-mixer';
  const iconUrl = logseq.resolveResourceFullUrl('icon.png');
  const darkIconUrl = logseq.resolveResourceFullUrl('icon-dark-transparent.png');

  logseq.provideStyle(`
    div[data-injected-ui^='logseq-mixer'] {
      display: flex;
      align-items: center;
      font-weight: 500;
      position: relative;
      --logseq-mixer-light-display: block;
      --logseq-mixer-dark-display: none;
    }
    html[data-theme='dark'] div[data-injected-ui^='logseq-mixer'],
    .dark-theme div[data-injected-ui^='logseq-mixer'] {
      --logseq-mixer-light-display: none;
      --logseq-mixer-dark-display: block;
    }
    html[data-theme='light'] div[data-injected-ui^='logseq-mixer'],
    .light-theme div[data-injected-ui^='logseq-mixer'] {
      --logseq-mixer-light-display: block;
      --logseq-mixer-dark-display: none;
    }
  `);

  logseq.App.registerUIItem('toolbar', {
    key: toolbarButtonKey,
    template: `
      <a data-on-click="show" class="button"
         style="display: flex; align-items: center; justify-content: center; width: 36px; height: 36px;">
        <img src="${iconUrl}" width="20" height="20" style="border-radius: 4px; display: var(--logseq-mixer-light-display, block);" />
        <img src="${darkIconUrl}" width="20" height="20" style="border-radius: 4px; display: var(--logseq-mixer-dark-display, none);" />
      </a>
    `,
  });
}

logseq.useSettingsSchema(settings);
logseq.ready().then(main).catch(console.error);
