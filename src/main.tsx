import '@logseq/libs';
import { setIsUpdatingSettings } from 'indexManager';
import React from 'react';
import ReactDOM from 'react-dom';
import { RecoilRoot } from 'recoil';
import 'VectorDBManager';
import App from './App';
import settings from './settings';
import { createStorageProvider } from './storage/createStorageProvider';
import { migrateStorage } from './storage/migrate';

async function main() {
  const key = logseq.baseInfo.id;
  console.info(`${key}: MAIN`);

  // Read storage backend setting (default to 'sqlite' on first run)
  const storageBackend = (logseq.settings?.storageBackend as 'sqlite' | 'settings') ?? 'sqlite';
  const lastStorageBackend = logseq.settings?.lastStorageBackend as string | undefined;

  // Create the active storage provider
  const storageProvider = await createStorageProvider(storageBackend);

  // Migrate data when backend changed, or on first run upgrading to sqlite
  // Only migrate if the SQLite provider has no data (avoid wiping existing data)
  const needsMigration =
    (lastStorageBackend && lastStorageBackend !== storageBackend) ||
    (!lastStorageBackend && storageBackend === 'sqlite');

  if (needsMigration) {
    const oldBackend = (lastStorageBackend as 'sqlite' | 'settings') ?? 'settings';
    if (oldBackend !== storageBackend) {
      // Only migrate if the target provider is empty
      const existingTargetData = await storageProvider.load();
      if (!existingTargetData) {
        console.info(`Migrating storage from "${oldBackend}" to "${storageBackend}"...`);
        try {
          const oldProvider = await createStorageProvider(oldBackend);
          await migrateStorage(oldProvider, storageProvider);
          console.info('Storage migration completed.');
        } catch (err) {
          console.error('Storage migration failed:', err);
        }
      } else {
        console.info('Target storage already has data, skipping migration.');
      }
    }
  }

  // Track the current backend so we can detect changes on next startup
  setIsUpdatingSettings(true);
  try {
    await logseq.updateSettings({ lastStorageBackend: storageBackend });
  } finally {
    setIsUpdatingSettings(false);
  }

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
          //console.log("Scrolled to bottom");
        } else {
          console.warn("Messages container not found.");
        }
      }, 300); // Adjust the delay if needed.
    },
  });

  logseq.setMainUIInlineStyle({
    position: 'fixed',
    zIndex: 11,
  });

  const toolbarButtonKey = 'logseq-composer';

  logseq.provideStyle(`
    div[data-injected-ui=${toolbarButtonKey}-${key}] {
      display: flex;
      align-items: center;
      font-weight: 500;
      position: relative;
    }
  `);

  logseq.App.registerUIItem('toolbar', {
    key: toolbarButtonKey,
    template: `
      <a data-on-click="show" class="button"
         style="display: flex; align-items: center; justify-content: center; width: 36px; height: 36px;">
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="currentColor" viewBox="0 0 24 24">
  <path fill-rule="evenodd" d="M8 7V2.221a2 2 0 0 0-.5.365L3.586 6.5a2 2 0 0 0-.365.5H8Zm2 0V2h7a2 2 0 0 1 2 2v.126a5.087 5.087 0 0 0-4.74 1.368v.001l-6.642 6.642a3 3 0 0 0-.82 1.532l-.74 3.692a3 3 0 0 0 3.53 3.53l3.694-.738a3 3 0 0 0 1.532-.82L19 15.149V20a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9h5a2 2 0 0 0 2-2Z" clip-rule="evenodd"/>
  <path fill-rule="evenodd" d="M17.447 8.08a1.087 1.087 0 0 1 1.187.238l.002.001a1.088 1.088 0 0 1 0 1.539l-.377.377-1.54-1.542.373-.374.002-.001c.1-.102.22-.182.353-.237Zm-2.143 2.027-4.644 4.644-.385 1.924 1.925-.385 4.644-4.642-1.54-1.54Zm2.56-4.11a3.087 3.087 0 0 0-2.187.909l-6.645 6.645a1 1 0 0 0-.274.51l-.739 3.693a1 1 0 0 0 1.177 1.176l3.693-.738a1 1 0 0 0 .51-.274l6.65-6.646a3.088 3.088 0 0 0-2.185-5.275Z" clip-rule="evenodd"/>
</svg>

      </a>
    `,
  });
  
}

logseq.useSettingsSchema(settings);
logseq.ready().then(main).catch(console.error);
