import { describe, expect, it } from 'vitest';
import { normalizeBlockContent } from './normalizer';

describe('normalizeBlockContent', () => {
  // Requirement 6.1: Heading markers
  it('strips heading markers', () => {
    expect(normalizeBlockContent('# Heading 1')).toBe('Heading 1');
    expect(normalizeBlockContent('## Heading 2')).toBe('Heading 2');
    expect(normalizeBlockContent('### Heading 3')).toBe('Heading 3');
    expect(normalizeBlockContent('###### Heading 6')).toBe('Heading 6');
  });

  // Requirement 6.2: Bold markers
  it('strips bold markers (**text** and __text__)', () => {
    expect(normalizeBlockContent('**bold**')).toBe('bold');
    expect(normalizeBlockContent('__bold__')).toBe('bold');
    expect(normalizeBlockContent('some **bold** text')).toBe('some bold text');
  });

  // Requirement 6.3: Italic markers
  it('strips italic markers (*text* and _text_)', () => {
    expect(normalizeBlockContent('*italic*')).toBe('italic');
    expect(normalizeBlockContent('_italic_')).toBe('italic');
    expect(normalizeBlockContent('some *italic* text')).toBe('some italic text');
  });

  // Requirement 6.4: Strikethrough markers
  it('strips strikethrough markers', () => {
    expect(normalizeBlockContent('~~struck~~')).toBe('struck');
    expect(normalizeBlockContent('some ~~struck~~ text')).toBe('some struck text');
  });

  // Requirement 6.5: Highlight markers
  it('strips highlight markers', () => {
    expect(normalizeBlockContent('==highlighted==')).toBe('highlighted');
    expect(normalizeBlockContent('some ==highlighted== text')).toBe('some highlighted text');
  });

  // Requirement 6.6: Checkbox syntax
  it('normalizes checkbox syntax to plain list items', () => {
    expect(normalizeBlockContent('- [ ] unchecked')).toBe('- unchecked');
    expect(normalizeBlockContent('- [x] checked')).toBe('- checked');
    expect(normalizeBlockContent('- [X] checked')).toBe('- checked');
  });

  // Requirement 6.7: Blockquote markers
  it('strips blockquote markers', () => {
    expect(normalizeBlockContent('> quote')).toBe('quote');
    expect(normalizeBlockContent('> some quoted text')).toBe('some quoted text');
  });

  // Requirement 6.8: Inline code backticks
  it('strips inline code backticks', () => {
    expect(normalizeBlockContent('`code`')).toBe('code');
    expect(normalizeBlockContent('use `npm install` here')).toBe('use npm install here');
  });

  // Requirement 6.9: Page links
  it('converts page links to plain text', () => {
    expect(normalizeBlockContent('[[page]]')).toBe('page');
    expect(normalizeBlockContent('see [[My Page]] for details')).toBe('see My Page for details');
  });

  // Requirement 6.10: Preserves semantic content
  it('preserves plain text without formatting', () => {
    expect(normalizeBlockContent('plain text')).toBe('plain text');
    expect(normalizeBlockContent('')).toBe('');
  });

  // Bold before italic ordering
  it('handles bold+italic correctly due to ordering', () => {
    expect(normalizeBlockContent('***bold italic***')).toBe('bold italic');
    expect(normalizeBlockContent('**bold** and *italic*')).toBe('bold and italic');
  });

  // Combined formatting
  it('handles multiple formatting types in one line', () => {
    expect(normalizeBlockContent('## **Bold** heading with [[link]]'))
      .toBe('Bold heading with link');
    expect(normalizeBlockContent('- [x] ~~done~~ task with `code`'))
      .toBe('- done task with code');
  });
});
