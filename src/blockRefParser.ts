/** A segment of parsed text — either plain text or a block reference. */
export type BlockRefSegment =
  | { type: 'text'; value: string }
  | { type: 'blockRef'; uuid: string };

/** Matches ((uuid)) where uuid is hex chars and hyphens, starting and ending with a hex char. */
export const BLOCK_REF_REGEX = /\(\(([0-9a-f][0-9a-f-]*[0-9a-f])\)\)/gi;

/**
 * Parse raw text containing ((uuid)) patterns into segments.
 * - Extracts all ((...)) occurrences where content matches UUID format (hex and hyphens).
 * - Non-UUID content inside ((...)) is treated as plain text.
 * - Empty parens (()) are treated as plain text.
 * - All text outside matched patterns is preserved as text segments.
 */
export function parse(input: string): BlockRefSegment[] {
  if (input === '') return [];

  const segments: BlockRefSegment[] = [];
  const regex = new RegExp(BLOCK_REF_REGEX.source, 'gi');
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(input)) !== null) {
    // Add any text before this match
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: input.slice(lastIndex, match.index) });
    }
    // Add the block reference segment
    segments.push({ type: 'blockRef', uuid: match[1] });
    lastIndex = regex.lastIndex;
  }

  // Add any remaining text after the last match
  if (lastIndex < input.length) {
    segments.push({ type: 'text', value: input.slice(lastIndex) });
  }

  return segments;
}

/**
 * Serialize a segment list back into a raw text string.
 * Inverse of parse — text segments emit their value,
 * blockRef segments emit ((uuid)).
 */
export function serialize(segments: BlockRefSegment[]): string {
  return segments
    .map((seg) => (seg.type === 'text' ? seg.value : `((${seg.uuid}))`))
    .join('');
}

/**
 * Transform raw text by replacing ((uuid)) patterns with
 * markdown links using the logseq://block/ scheme.
 * e.g., "See ((abc-123)) for details" →
 *        "See [((abc-123))](logseq://block/abc-123) for details"
 * Non-UUID content inside ((...)) is left as-is.
 */
export function transformToMarkdownLinks(input: string): string {
  return input.replaceAll(BLOCK_REF_REGEX, (_match, uuid: string) => {
    return `[((${uuid}))](logseq://block/${uuid})`;
  });
}
