/**
 * Unit tests for PageLink component
 *
 * **Validates: Requirements 2.1, 3.1, 3.2**
 */

// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Mock stitches config — render styled components as plain HTML elements
vi.mock('../stitches.config', () => {
  const styled = (tag: string, _styles?: any) => {
    const Component = React.forwardRef((props: any, ref: any) => {
      const { css: _css, ...rest } = props;
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

// Setup logseq global mock
beforeAll(() => {
  (globalThis as any).logseq = {
    App: {
      pushState: vi.fn(),
    },
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

import { PageLink } from './PageLink';

describe('PageLink component', () => {
  /**
   * Requirement 2.1: rendered text includes [[ and ]] around the page name
   */
  it('renders text with [[ and ]] around the page name', () => {
    const { container } = render(<PageLink pageName="My Page" />);
    expect(container.textContent).toBe('[[My Page]]');
  });

  it('renders text with brackets for a single-word page name', () => {
    const { container } = render(<PageLink pageName="Tasks" />);
    expect(container.textContent).toBe('[[Tasks]]');
  });

  /**
   * Requirement 3.1, 3.2: logseq.App.pushState is called with correct arguments on click
   */
  it('calls logseq.App.pushState with correct arguments on click', () => {
    const { container } = render(<PageLink pageName="My Page" />);
    const span = container.firstElementChild!;
    fireEvent.click(span);

    expect((globalThis as any).logseq.App.pushState).toHaveBeenCalledTimes(1);
    expect((globalThis as any).logseq.App.pushState).toHaveBeenCalledWith('page', { name: 'My Page' });
  });

  it('calls logseq.App.pushState with the correct page name for special characters', () => {
    const { container } = render(<PageLink pageName="Page/With Specials" />);
    const span = container.firstElementChild!;
    fireEvent.click(span);

    expect((globalThis as any).logseq.App.pushState).toHaveBeenCalledWith('page', { name: 'Page/With Specials' });
  });

  /**
   * Requirement 2.1: renders as an inline element (span)
   */
  it('renders as an inline element', () => {
    const { container } = render(<PageLink pageName="Test" />);
    const el = container.firstElementChild!;
    expect(el.tagName.toLowerCase()).toBe('span');
  });

  /**
   * When children are provided, they are rendered instead of the default [[pageName]] text
   */
  it('renders children when provided instead of default bracket text', () => {
    const { container } = render(<PageLink pageName="Test">Custom Label</PageLink>);
    expect(container.textContent).toBe('Custom Label');
  });

  /**
   * Error handling: logseq.App.pushState throwing does not crash the component
   */
  it('does not throw when logseq.App.pushState throws', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    (globalThis as any).logseq.App.pushState.mockImplementation(() => {
      throw new Error('Navigation failed');
    });

    const { container } = render(<PageLink pageName="Broken" />);
    const span = container.firstElementChild!;

    expect(() => fireEvent.click(span)).not.toThrow();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
