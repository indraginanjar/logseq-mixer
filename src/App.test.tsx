/**
 * Bug Condition Exploration Test — Re-Index button state on remount
 *
 * **Validates: Requirements 1.1, 1.2, 1.3**
 *
 * This test encodes the EXPECTED (correct) behavior:
 * - When `isIndexingActive()` returns `true` at mount, the button should show "⏹ Stop"
 * - When `isIndexingActive()` returns `false` at mount, the button should show "🔄 Re-Index"
 *
 * On UNFIXED code, the test FAILS because `useState(false)` ignores `isIndexingActive()`.
 * After the fix (`useState(isIndexingActive())`), the test will PASS.
 */

// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import * as fc from 'fast-check';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/** Flush microtasks so React state updates settle. */
const flushPromises = () => act(() => new Promise((r) => setTimeout(r, 0)));

// --- Mock modules BEFORE importing App ---

// Mock indexManager
vi.mock('./indexManager', () => ({
  isIndexingActive: vi.fn(() => false),
  requestPauseIndexing: vi.fn(),
}));

// Mock manager
vi.mock('./manager', () => ({
  clearConversationHistory: vi.fn(),
  enableAutoIndexer: vi.fn(),
  handleQuery: vi.fn(),
  indexEntireLogSeq: vi.fn(() => Promise.resolve()),
}));

// Mock useAppVisible to always return true so the component renders
vi.mock('./hooks/useAppVisible', () => ({
  useAppVisible: vi.fn(() => true),
}));

// Mock useThemeMode
vi.mock('./hooks/useThemeMode', () => ({
  useThemeMode: vi.fn(() => 'light'),
}));

// Mock recoil
vi.mock('recoil', () => ({
  useRecoilValue: vi.fn(() => ({
    selectedModel: 'test',
    prompt: '',
    EmbeddingApiKey: '',
    LiteLLMLink: '',
    apiKey: '',
    embeddingModel: '',
    VectorDBLogseqCopilot: '',
  })),
  atom: vi.fn(() => ({})),
  RecoilRoot: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock stitches config — provide minimal styled/keyframes/darkTheme
vi.mock('./stitches.config', () => {
  const styled = (tag: string, _styles?: any) => {
    const Component = React.forwardRef((props: any, ref: any) => {
      const { css: _css, variant, delay, ...rest } = props;
      return React.createElement(tag, { ...rest, ref });
    });
    Component.displayName = `Styled(${tag})`;
    return Component;
  };
  return {
    styled,
    keyframes: () => 'mock-keyframe',
    darkTheme: { className: 'dark' },
    css: () => '',
  };
});

// Mock ChatMessageList
vi.mock('./components/ChatMessageList', () => ({
  __esModule: true,
  default: () => React.createElement('div', { 'data-testid': 'chat-messages' }),
}));

// Mock state/settings
vi.mock('./state/settings', () => ({
  settingsState: {},
}));

// Setup logseq global
(globalThis as any).logseq = {
  isMainUIVisible: true,
  on: vi.fn(),
  off: vi.fn(),
  hideMainUI: vi.fn(),
  settings: {},
  onSettingsChanged: vi.fn(() => vi.fn()),
};
// Attach logseq to the existing window object instead of replacing it
if (typeof window !== 'undefined') {
  (window as any).logseq = (globalThis as any).logseq;
}

// Now import the modules
import { App } from './App';
import { isIndexingActive, requestPauseIndexing } from './indexManager';
import { indexEntireLogSeq } from './manager';

const mockIsIndexingActive = isIndexingActive as ReturnType<typeof vi.fn>;
const mockRequestPauseIndexing = requestPauseIndexing as ReturnType<typeof vi.fn>;
const mockIndexEntireLogSeq = indexEntireLogSeq as ReturnType<typeof vi.fn>;

const mockStorageProvider = {
  clear: vi.fn(() => Promise.resolve()),
  getDocumentCount: vi.fn(() => Promise.resolve(42)),
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Bug Condition Exploration: Re-Index button state on mount', () => {
  /**
   * Property 1: Bug Condition
   *
   * When isIndexingActive() returns true at mount time, the Re-Index button
   * MUST render as "⏹ Stop" with the pause variant.
   *
   * **Validates: Requirements 1.1, 1.2, 1.3**
   */
  it('property: button shows "⏹ Stop" when isIndexingActive() is true at mount', () => {
    fc.assert(
      fc.property(
        // Generate a boolean that is always true (scoped to bug condition)
        fc.constant(true),
        (indexingActive) => {
          cleanup();
          mockIsIndexingActive.mockReturnValue(indexingActive);

          const { container } = render(
            <App themeMode="light" storageProvider={mockStorageProvider as any} />
          );

          // Find the Re-Index / Stop button by its text content
          const buttons = container.querySelectorAll('button');
          const reindexButton = Array.from(buttons).find(
            (btn) => btn.textContent?.includes('Stop') || btn.textContent?.includes('Re-Index')
          );

          expect(reindexButton).toBeDefined();
          // The button MUST show "⏹ Stop" when indexing is active
          expect(reindexButton!.textContent).toContain('Stop');
        }
      ),
      { numRuns: 10 }
    );
  });

  /**
   * When isIndexingActive() is true and user clicks the button,
   * it should call requestPauseIndexing() — NOT indexEntireLogSeq.
   *
   * **Validates: Requirements 1.2, 1.3**
   */
  it('property: clicking button calls requestPauseIndexing when isIndexingActive() is true at mount', () => {
    fc.assert(
      fc.property(
        fc.constant(true),
        (indexingActive) => {
          cleanup();
          vi.clearAllMocks();
          mockIsIndexingActive.mockReturnValue(indexingActive);

          const { container } = render(
            <App themeMode="light" storageProvider={mockStorageProvider as any} />
          );

          const buttons = container.querySelectorAll('button');
          const reindexButton = Array.from(buttons).find(
            (btn) => btn.textContent?.includes('Stop') || btn.textContent?.includes('Re-Index')
          );

          expect(reindexButton).toBeDefined();
          fireEvent.click(reindexButton!);

          // Should call requestPauseIndexing, NOT indexEntireLogSeq
          expect(mockRequestPauseIndexing).toHaveBeenCalled();
          expect(mockIndexEntireLogSeq).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 10 }
    );
  });

  /**
   * Baseline: when isIndexingActive() returns false, button shows "🔄 Re-Index".
   * This should PASS on both unfixed and fixed code.
   *
   * **Validates: Requirements 1.1 (inverse case)**
   */
  it('property: button shows "🔄 Re-Index" when isIndexingActive() is false at mount', () => {
    fc.assert(
      fc.property(
        fc.constant(false),
        (indexingActive) => {
          cleanup();
          mockIsIndexingActive.mockReturnValue(indexingActive);

          const { container } = render(
            <App themeMode="light" storageProvider={mockStorageProvider as any} />
          );

          const buttons = container.querySelectorAll('button');
          const reindexButton = Array.from(buttons).find(
            (btn) => btn.textContent?.includes('Stop') || btn.textContent?.includes('Re-Index')
          );

          expect(reindexButton).toBeDefined();
          expect(reindexButton!.textContent).toContain('Re-Index');
        }
      ),
      { numRuns: 10 }
    );
  });
});


describe('Preservation: Visible-panel indexing lifecycle unchanged', () => {
  /**
   * Property 2a: Normal mount preservation
   *
   * For all non-bug-condition inputs (mount with isIndexingActive() = false),
   * the button shows "🔄 Re-Index".
   *
   * **Validates: Requirements 3.3**
   */
  it('property: button shows "🔄 Re-Index" when mounting with isIndexingActive() = false', () => {
    fc.assert(
      fc.property(
        fc.constant(false),
        (_indexingActive) => {
          cleanup();
          vi.clearAllMocks();
          mockIsIndexingActive.mockReturnValue(false);
          mockIndexEntireLogSeq.mockImplementation(() => Promise.resolve());

          const { container } = render(
            <App themeMode="light" storageProvider={mockStorageProvider as any} />
          );

          const buttons = container.querySelectorAll('button');
          const reindexButton = Array.from(buttons).find(
            (btn) => btn.textContent?.includes('Stop') || btn.textContent?.includes('Re-Index')
          );

          expect(reindexButton).toBeDefined();
          expect(reindexButton!.textContent).toContain('Re-Index');
        }
      ),
      { numRuns: 10 }
    );
  });

  /**
   * Property 2b: Indexing flow button transitions
   *
   * For all visible-panel indexing flows (no unmount/remount), clicking
   * "🔄 Re-Index" calls indexEntireLogSeq and transitions button to "⏹ Stop",
   * then when indexing completes the button reverts to "🔄 Re-Index".
   *
   * **Validates: Requirements 3.1**
   */
  it('property: clicking Re-Index calls indexEntireLogSeq and transitions button to Stop then back', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constant(null),
        async () => {
          cleanup();
          vi.clearAllMocks();
          mockIsIndexingActive.mockReturnValue(false);

          // Create a controllable promise for indexEntireLogSeq
          let resolveIndexing!: () => void;
          const indexingPromise = new Promise<void>((resolve) => {
            resolveIndexing = resolve;
          });
          mockIndexEntireLogSeq.mockImplementation(() => indexingPromise);

          const { container } = render(
            <App themeMode="light" storageProvider={mockStorageProvider as any} />
          );

          // Initially shows "🔄 Re-Index"
          const findButton = () => {
            const buttons = container.querySelectorAll('button');
            return Array.from(buttons).find(
              (btn) => btn.textContent?.includes('Stop') || btn.textContent?.includes('Re-Index')
            );
          };

          const reindexButton = findButton();
          expect(reindexButton).toBeDefined();
          expect(reindexButton!.textContent).toContain('Re-Index');

          // Click "🔄 Re-Index"
          fireEvent.click(reindexButton!);

          // indexEntireLogSeq should have been called
          expect(mockIndexEntireLogSeq).toHaveBeenCalled();

          // Button should now show "⏹ Stop" after state update
          await flushPromises();
          expect(findButton()!.textContent).toContain('Stop');

          // Resolve the indexing promise (indexing completes)
          resolveIndexing();

          // Button should revert to "🔄 Re-Index"
          await flushPromises();
          expect(findButton()!.textContent).toContain('Re-Index');
        }
      ),
      { numRuns: 5 }
    );
  });

  /**
   * Property 2c: Stop button calls requestPauseIndexing during active indexing
   *
   * When the user clicks "⏹ Stop" during an active indexing operation
   * (panel stays visible), requestPauseIndexing() is called.
   *
   * **Validates: Requirements 3.2**
   */
  it('property: clicking Stop during active indexing calls requestPauseIndexing', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constant(null),
        async () => {
          cleanup();
          vi.clearAllMocks();
          mockIsIndexingActive.mockReturnValue(false);

          // indexEntireLogSeq never resolves — simulates ongoing indexing
          mockIndexEntireLogSeq.mockImplementation(() => new Promise<void>(() => {}));

          const { container } = render(
            <App themeMode="light" storageProvider={mockStorageProvider as any} />
          );

          const findButton = () => {
            const buttons = container.querySelectorAll('button');
            return Array.from(buttons).find(
              (btn) => btn.textContent?.includes('Stop') || btn.textContent?.includes('Re-Index')
            );
          };

          // Click "🔄 Re-Index" to start indexing
          const reindexButton = findButton();
          expect(reindexButton).toBeDefined();
          fireEvent.click(reindexButton!);

          // Wait for button to transition to "⏹ Stop"
          await flushPromises();
          expect(findButton()!.textContent).toContain('Stop');

          // Click "⏹ Stop"
          fireEvent.click(findButton()!);

          // requestPauseIndexing should have been called
          expect(mockRequestPauseIndexing).toHaveBeenCalled();
        }
      ),
      { numRuns: 5 }
    );
  });

  /**
   * Property 2d: Error handling displays error banner and reverts button
   *
   * When indexing fails with an error, the error banner displays and
   * the button reverts to "🔄 Re-Index".
   *
   * **Validates: Requirements 3.4**
   */
  it('property: indexing error displays error banner and reverts button to Re-Index', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }),
        async (errorMessage) => {
          cleanup();
          vi.clearAllMocks();
          mockIsIndexingActive.mockReturnValue(false);

          // indexEntireLogSeq rejects with an error
          mockIndexEntireLogSeq.mockImplementation(() =>
            Promise.reject(new Error(errorMessage))
          );

          const { container } = render(
            <App themeMode="light" storageProvider={mockStorageProvider as any} />
          );

          const findButton = () => {
            const buttons = container.querySelectorAll('button');
            return Array.from(buttons).find(
              (btn) => btn.textContent?.includes('Stop') || btn.textContent?.includes('Re-Index')
            );
          };

          // Click "🔄 Re-Index" to start indexing (which will fail)
          const reindexButton = findButton();
          expect(reindexButton).toBeDefined();
          fireEvent.click(reindexButton!);

          // Wait for the error to be handled and button to revert
          await flushPromises();
          expect(findButton()!.textContent).toContain('Re-Index');

          // Error banner should be displayed with the error message
          expect(container.textContent).toContain(errorMessage);
        }
      ),
      { numRuns: 10 }
    );
  });
});
