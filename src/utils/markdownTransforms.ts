/**
 * Markdown transform utilities extracted from ChatMessageList.tsx.
 * These functions transform Logseq-specific markdown syntax (properties, tags,
 * task markers, checkboxes, bare URLs) into standard markdown links that the
 * renderer can interpret.
 */

/**
 * Parse Logseq-style property lines (key:: value) from the top of a text block.
 * Returns the extracted properties and the remaining content.
 */
export function parseProperties(text: string): { properties: Record<string, string>; content: string } {
  const lines = text.split('\n');
  const properties: Record<string, string> = {};
  const contentLines: string[] = [];
  let readingProperties = true;

  for (const line of lines) {
    const trimmed = line.trim();
    if (readingProperties && trimmed.includes('::')) {
      const parts = trimmed.split('::');
      const key = parts[0].trim();
      const val = parts.slice(1).join('::').trim();
      if (key && /^[a-zA-Z0-9-_]+$/.test(key)) {
        properties[key] = val;
        continue;
      }
    }
    if (trimmed !== '') {
      readingProperties = false;
    }
    contentLines.push(line);
  }

  return { properties, content: contentLines.join('\n') };
}

/**
 * Transform Logseq #[[tag]] and #tag syntax into markdown links.
 */
export function transformTags(input: string): string {
  let transformed = input.replace(/#\[\[([^\]]+)\]\]/g, (_match, name) => {
    return `[#${name}](logseq://page/${encodeURIComponent(name)})`;
  });
  transformed = transformed.replace(/(?<![a-zA-Z0-9-_\[/])#([a-zA-Z0-9-_]+)/g, (_match, name) => {
    return `[#${name}](logseq://page/${encodeURIComponent(name)})`;
  });
  return transformed;
}

/**
 * Transform Logseq task markers (TODO, DOING, DONE, etc.) into markdown links
 * that the renderer interprets as styled badges.
 */
export function transformTaskMarkers(input: string): string {
  const markers = ['TODO', 'DOING', 'DONE', 'LATER', 'NOW', 'WAITING', 'CANCELLED'];
  let transformed = input;
  for (const marker of markers) {
    const regex = new RegExp(`(^|\\n|-\\s+|\\*\\s+|\\d+\\.\\s+)(${marker})\\b`, 'g');
    transformed = transformed.replaceAll(regex, (match, prefix, m) => {
      return `${prefix}[${m}](logseq://task/${m})`;
    });
  }
  return transformed;
}

/**
 * Transform markdown-style checkboxes [ ] and [x] into special links
 * that the renderer interprets as checkbox inputs.
 */
export function transformCheckboxes(input: string): string {
  let transformed = input.replaceAll(/\[ \]/g, '[ ](logseq://checkbox/unchecked)');
  transformed = transformed.replaceAll(/\[x\]/gi, '[x](logseq://checkbox/checked)');
  return transformed;
}

/**
 * Transform bare http/https URLs into markdown links so they become clickable.
 * Skips URLs already inside markdown link syntax: [text](url) or ![alt](url)
 */
export function transformBareUrls(input: string): string {
  // Match bare URLs not preceded by ]( which would indicate they're already a markdown link target
  return input.replace(
    /(?<!\]\()(?<!\()(?<!")(https?:\/\/[^\s<>"{}|\\^`\]]+)/gi,
    (match, url: string) => {
      // Clean trailing punctuation that's likely not part of the URL
      let cleanUrl = url;
      // Strip trailing punctuation, but respect balanced parentheses (Wikipedia URLs)
      const trailingMatch = /[.,;:!?]+$/.exec(cleanUrl);
      let suffix = '';
      if (trailingMatch) {
        cleanUrl = cleanUrl.slice(0, -trailingMatch[0].length);
        suffix = trailingMatch[0];
      }
      // Handle trailing ) — only strip if parens are unbalanced
      while (cleanUrl.endsWith(')')) {
        const openCount = (cleanUrl.match(/\(/g) || []).length;
        const closeCount = (cleanUrl.match(/\)/g) || []).length;
        if (closeCount > openCount) {
          suffix = ')' + suffix;
          cleanUrl = cleanUrl.slice(0, -1);
        } else {
          break;
        }
      }
      return `[${cleanUrl}](${cleanUrl})${suffix}`;
    }
  );
}

export type ContentPart =
  | { type: 'markdown'; content: string }
  | { type: 'table'; headers: string[]; rows: string[][]; rawContent: string };

/**
 * Parse a markdown string into segments of plain markdown and table structures.
 * Tables are detected by pipe-delimited rows with a separator line containing ---.
 */
export function parseContentWithTables(input: string): ContentPart[] {
  const lines = input.split('\n');
  const parts: ContentPart[] = [];
  let currentMarkdownLines: string[] = [];
  let currentTableLines: string[] = [];
  let inCodeBlock = false;

  const flushMarkdown = () => {
    if (currentMarkdownLines.length > 0) {
      parts.push({
        type: 'markdown',
        content: currentMarkdownLines.join('\n'),
      });
      currentMarkdownLines = [];
    }
  };

  const flushTable = () => {
    if (currentTableLines.length >= 2) {
      // Find the separator row (contains only |, -, :, and whitespace with at least ---)
      const separatorIdx = currentTableLines.findIndex(l => {
        const t = l.trim();
        return t.includes('|') && /^[\s|:-]+$/.test(t) && /---/.test(t);
      });

      if (separatorIdx < 1) {
        // No valid separator found or separator is the first line — treat as markdown
        currentMarkdownLines.push(...currentTableLines);
        currentTableLines = [];
        return;
      }

      const headerLine = currentTableLines[separatorIdx - 1];
      const rowsLines = currentTableLines.slice(separatorIdx + 1);
      const rawContent = currentTableLines.join('\n');

      const splitRow = (line: string) => {
        const cells = line.split('|').map(c => c.trim());
        if (cells[0] === '') cells.shift();
        if (cells[cells.length - 1] === '') cells.pop();
        return cells;
      };

      const headers = splitRow(headerLine);
      const rows = rowsLines
        .filter(l => l.trim() !== '') // skip any empty lines in rows
        .map(splitRow);

      // Only emit as table if we have headers and at least the structure is valid
      if (headers.length > 0) {
        // If there were lines before the header, flush them as markdown
        const preHeaderLines = currentTableLines.slice(0, separatorIdx - 1);
        if (preHeaderLines.length > 0) {
          currentMarkdownLines.push(...preHeaderLines);
          flushMarkdown();
        }

        parts.push({
          type: 'table',
          headers,
          rows,
          rawContent,
        });
      } else {
        currentMarkdownLines.push(...currentTableLines);
      }
      currentTableLines = [];
    } else if (currentTableLines.length > 0) {
      // Not enough lines for a table, treat as regular markdown
      currentMarkdownLines.push(...currentTableLines);
      currentTableLines = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    // Toggle code block state if we see a fence
    const isFence = /^\s*(?:[-*+]\s+|\d+\.\s+)?(`{3,}|~{3,})/.test(line);
    if (isFence) {
      inCodeBlock = !inCodeBlock;
    }

    // Detect table lines: either has leading/trailing pipes, or has interior pipes
    // and is part of a table context (separator row confirms table)
    const hasPipes = !inCodeBlock && trimmed.includes('|');
    const isClassicTableLine = hasPipes && trimmed.startsWith('|') && trimmed.endsWith('|');
    const isSeparatorRow = hasPipes && /^[\s|:-]+$/.test(trimmed) && /---/.test(trimmed);

    // Skip empty lines while collecting table lines (LLMs sometimes add blank lines in tables)
    if (currentTableLines.length > 0 && trimmed === '') {
      continue;
    }

    if (isClassicTableLine || isSeparatorRow) {
      flushMarkdown();
      currentTableLines.push(line);
    } else if (hasPipes && currentTableLines.length > 0) {
      // Already collecting table lines — continue collecting
      currentTableLines.push(line);
    } else if (hasPipes && currentTableLines.length === 0) {
      // Potential table header without leading/trailing pipes — look ahead for separator
      const nextNonEmpty = lines.slice(i + 1).find(l => l.trim() !== '');
      const nextTrimmed = nextNonEmpty?.trim() || '';
      const nextIsSeparator = nextTrimmed.includes('|') && /^[\s|:-]+$/.test(nextTrimmed) && /---/.test(nextTrimmed);
      if (nextIsSeparator) {
        flushMarkdown();
        currentTableLines.push(line);
      } else {
        flushTable();
        currentMarkdownLines.push(line);
      }
    } else {
      flushTable();
      currentMarkdownLines.push(line);
    }
  }

  flushMarkdown();
  flushTable();

  return parts;
}
