/**
 * Markdown normalization for block content.
 * Strips formatting syntax while preserving semantic text.
 */

/**
 * Strip markdown formatting from a single block line.
 * Preserves the semantic text content.
 *
 * Rules are applied in order:
 * 1. Heading markers
 * 2. Bold (before italic to avoid partial matches)
 * 3. Italic
 * 4. Strikethrough
 * 5. Highlight
 * 6. Checkbox
 * 7. Blockquote
 * 8. Inline code
 * 9. Page links
 */
export function normalizeBlockContent(content: string): string {
  let result = content;

  // 1. Heading markers: strip leading # symbols
  result = result.replace(/^#{1,6}\s+/, '');

  // 2. Bold: **text** and __text__ (must come before italic)
  result = result.replaceAll(/\*\*(.+?)\*\*/g, '$1');
  result = result.replaceAll(/__(.+?)__/g, '$1');

  // 3. Italic: *text* and _text_
  result = result.replaceAll(/\*(.+?)\*/g, '$1');
  result = result.replaceAll(/_(.+?)_/g, '$1');

  // 4. Strikethrough: ~~text~~
  result = result.replaceAll(/~~(.+?)~~/g, '$1');

  // 5. Highlight: ==text==
  result = result.replaceAll(/==(.+?)==/g, '$1');

  // 6. Checkbox: - [ ], - [x], - [X] → - 
  result = result.replace(/^- \[[ xX]\]\s*/, '- ');

  // 7. Blockquote: leading > marker
  result = result.replace(/^>\s*/, '');

  // 8. Inline code: `code`
  result = result.replaceAll(/`([^`]+)`/g, '$1');

  // 9. Page links: [[page name]] → page name
  result = result.replaceAll(/\[\[(.+?)\]\]/g, '$1');

  return result;
}
