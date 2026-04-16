/** A segment of parsed text — either plain text or a page link. */
export type Segment =
  | { type: 'text'; value: string }
  | { type: 'pageLink'; name: string };

/** Matches [[page name]] where page name is non-empty and contains no brackets. */
// eslint-disable-next-line no-useless-escape
export const PAGE_LINK_REGEX = /\[\[([^\[\]]+)\]\]/g;

/**
 * Parse raw text containing [[page name]] patterns into segments.
 * - Extracts all [[...]] occurrences as pageLink segments.
 * - Empty brackets [[]] are treated as plain text (regex requires non-empty content).
 * - Nested brackets [[[text]]] extract the innermost [[text]].
 * - All text outside brackets is preserved as text segments.
 */
export function parse(input: string): Segment[] {
  if (input === '') return [];

  const segments: Segment[] = [];
  const regex = new RegExp(PAGE_LINK_REGEX.source, 'g');
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(input)) !== null) {
    // Add any text before this match
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: input.slice(lastIndex, match.index) });
    }
    // Add the page link segment
    segments.push({ type: 'pageLink', name: match[1] });
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
 * pageLink segments emit [[name]].
 */
export function serialize(segments: Segment[]): string {
  return segments
    .map((seg) => (seg.type === 'text' ? seg.value : `[[${seg.name}]]`))
    .join('');
}

/**
 * Transform raw text by replacing [[page name]] patterns with
 * markdown links using the logseq:// scheme.
 * e.g., "See [[My Page]] for details" →
 *        "See [My Page](logseq://page/My%20Page) for details"
 * Empty brackets [[]] are left as-is.
 */
export function transformToMarkdownLinks(input: string): string {
  return input.replaceAll(PAGE_LINK_REGEX, (_match, name: string) => {
    return `[${name}](logseq://page/${encodeURIComponent(name)})`;
  });
}
