/**
 * Unit tests for BlockLink component
 *
 * **Validates: Requirements 6.2, 7.1, 7.2, 7.3**
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
    Editor: {
      scrollToBlockInPage: vi.fn(),
    },
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

import { BlockLink } from './BlockLink';

describe('BlockLink component', () => {
  const testUuid = '64a1b2c3-d4e5-6789-abcd-ef0123456789';

  /**
   * Requirement 6.2: displays content preview label when provided
   */
  it('renders content preview when label is provided', () => {
    const { container } = render(
      <BlockLink blockUuid={testUuid} label="This is a block preview" />
    );
    expect(container.textContent).toBe('This is a block preview');
  });

  /**
   * Requirement 6.2: falls back to truncated UUID (first 8 chars + "…") when no label
   */
  it('falls back to truncated UUID when no label is provided', () => {
    const { container } = render(<BlockLink blockUuid={testUuid} />);
    expect(container.textContent).toBe('64a1b2c3…');
  });

  /**
   * Requirement 7.1: scrollToBlockInPage called with pageName and blockUuid when pageName is available
   */
  it('calls scrollToBlockInPage with pageName and blockUuid on click', () => {
    const { container } = render(
      <BlockLink blockUuid={testUuid} label="Preview" pageName="My Page" />
    );
    const span = container.firstElementChild!;
    fireEvent.click(span);

    expect((globalThis as any).logseq.Editor.scrollToBlockInPage).toHaveBeenCalledTimes(1);
    expect((globalThis as any).logseq.Editor.scrollToBlockInPage).toHaveBeenCalledWith(
      'My Page',
      testUuid
    );
  });

  /**
   * Requirement 7.2: scrollToBlockInPage called with blockUuid only when no pageName
   */
  it('calls scrollToBlockInPage with blockUuid only when no pageName', () => {
    const { container } = render(
      <BlockLink blockUuid={testUuid} label="Preview" />
    );
    const span = container.firstElementChild!;
    fireEvent.click(span);

    expect((globalThis as any).logseq.Editor.scrollToBlockInPage).toHaveBeenCalledTimes(1);
    expect((globalThis as any).logseq.Editor.scrollToBlockInPage).toHaveBeenCalledWith(testUuid, testUuid);
  });

  /**
   * Requirement 7.3: error is caught and logged when navigation throws
   */
  it('does not throw when scrollToBlockInPage throws', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    (globalThis as any).logseq.Editor.scrollToBlockInPage.mockImplementation(() => {
      throw new Error('Navigation failed');
    });

    const { container } = render(
      <BlockLink blockUuid={testUuid} label="Preview" pageName="My Page" />
    );
    const span = container.firstElementChild!;

    expect(() => fireEvent.click(span)).not.toThrow();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
