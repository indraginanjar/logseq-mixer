import { describe, expect, it } from 'vitest';
import { CrossPageDeduplicator, deduplicateBlocks } from './deduplicator';

describe('deduplicateBlocks', () => {
  // Requirement 5.3: First occurrence is retained
  it('keeps first occurrence and removes subsequent duplicates', () => {
    const input = ['alpha', 'beta', 'alpha', 'gamma', 'beta'];
    expect(deduplicateBlocks(input)).toEqual(['alpha', 'beta', 'gamma']);
  });

  // Requirement 5.2: Exact string matching
  it('uses exact string matching — different whitespace is not a duplicate', () => {
    const input = ['hello world', 'hello  world', 'hello world'];
    expect(deduplicateBlocks(input)).toEqual(['hello world', 'hello  world']);
  });

  // Requirement 5.4: Operates at block-line level before chunking
  it('returns all lines when there are no duplicates', () => {
    const input = ['one', 'two', 'three'];
    expect(deduplicateBlocks(input)).toEqual(['one', 'two', 'three']);
  });

  it('returns empty array for empty input', () => {
    expect(deduplicateBlocks([])).toEqual([]);
  });

  // Requirement 5.5: Within-page deduplication
  it('preserves original order of first occurrences', () => {
    const input = ['c', 'a', 'b', 'a', 'c', 'b'];
    expect(deduplicateBlocks(input)).toEqual(['c', 'a', 'b']);
  });

  it('handles single-element array', () => {
    expect(deduplicateBlocks(['only'])).toEqual(['only']);
  });

  it('handles all-duplicate input', () => {
    expect(deduplicateBlocks(['dup', 'dup', 'dup'])).toEqual(['dup']);
  });
});

describe('CrossPageDeduplicator', () => {
  // Requirement 5.1: Embed content only once across pages
  it('returns true for new content and false for duplicates', () => {
    const dedup = new CrossPageDeduplicator();
    expect(dedup.tryAdd('block A')).toBe(true);
    expect(dedup.tryAdd('block B')).toBe(true);
    expect(dedup.tryAdd('block A')).toBe(false);
  });

  // Requirement 5.6: Full indexing deduplicates across all pages
  it('tracks content across multiple simulated pages', () => {
    const dedup = new CrossPageDeduplicator();

    // Page 1
    expect(dedup.tryAdd('shared block')).toBe(true);
    expect(dedup.tryAdd('page1 only')).toBe(true);

    // Page 2
    expect(dedup.tryAdd('shared block')).toBe(false);
    expect(dedup.tryAdd('page2 only')).toBe(true);
  });

  it('clear() resets state for a new indexing run', () => {
    const dedup = new CrossPageDeduplicator();
    dedup.tryAdd('content');
    expect(dedup.tryAdd('content')).toBe(false);

    dedup.clear();
    expect(dedup.tryAdd('content')).toBe(true);
  });

  it('uses exact string matching', () => {
    const dedup = new CrossPageDeduplicator();
    expect(dedup.tryAdd('hello world')).toBe(true);
    expect(dedup.tryAdd('hello  world')).toBe(true);
    expect(dedup.tryAdd('hello world')).toBe(false);
  });
});
