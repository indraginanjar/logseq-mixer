/**
 * Detects and parses CSV table content in text.
 *
 * A block of text is considered CSV if:
 * - It has 2+ lines (header + at least one data row)
 * - Lines are separated by a consistent delimiter (comma, semicolon, or tab)
 * - All non-empty lines have the same number of fields (or within ±1 tolerance)
 * - It has at least 2 columns
 */

export interface CsvTable {
  headers: string[];
  rows: string[][];
  rawContent: string;
}

export interface CsvDetectionResult {
  type: 'csv';
  table: CsvTable;
}

export interface TextSegment {
  type: 'text';
  content: string;
}

export type CsvContentPart = CsvDetectionResult | TextSegment;

/**
 * Parse a single CSV line respecting quoted fields.
 * Handles fields wrapped in double quotes that may contain the delimiter or newlines.
 */
function parseCsvLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"') {
        // Check for escaped quote ""
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++; // skip next quote
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === delimiter) {
        fields.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
  }

  fields.push(current.trim());
  return fields;
}

/**
 * Detect the delimiter used in a set of lines.
 * Tests comma, semicolon, and tab. Returns the one that produces
 * the most consistent column count across lines.
 */
function detectDelimiter(lines: string[]): string | null {
  const candidates = [',', ';', '\t'];
  let bestDelimiter: string | null = null;
  let bestScore = 0;

  for (const delim of candidates) {
    const counts = lines.map(l => parseCsvLine(l, delim).length);
    // Need at least 2 columns
    if (counts[0] < 2) continue;

    // Check consistency: how many lines have the same count as the first line
    const targetCount = counts[0];
    const matching = counts.filter(c => c === targetCount).length;
    const score = matching / counts.length;

    if (score > bestScore) {
      bestScore = score;
      bestDelimiter = delim;
    }
  }

  // Require at least 80% of lines to have consistent column count
  if (bestScore < 0.8) return null;
  return bestDelimiter;
}

/**
 * Check if a block of consecutive lines looks like a CSV table.
 */
function isCsvBlock(lines: string[]): { valid: boolean; delimiter: string | null } {
  if (lines.length < 2) return { valid: false, delimiter: null };

  const delimiter = detectDelimiter(lines);
  if (!delimiter) return { valid: false, delimiter: null };

  const counts = lines.map(l => parseCsvLine(l, delimiter).length);
  const headerCount = counts[0];

  // Need at least 2 columns
  if (headerCount < 2) return { valid: false, delimiter: null };

  // Check that most rows have the same field count as header
  const consistent = counts.filter(c => c === headerCount).length;
  if (consistent / counts.length < 0.8) return { valid: false, delimiter: null };

  return { valid: true, delimiter };
}

/**
 * Determines whether a line is likely part of a CSV block vs. prose.
 * A line with multiple delimiters and no markdown formatting is a candidate.
 */
function isCsvCandidate(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed === '') return false;

  // Skip lines that look like markdown (headers, lists, links, etc.)
  if (/^#{1,6}\s/.test(trimmed)) return false;
  if (/^[-*+]\s/.test(trimmed)) return false;
  if (/^\d+\.\s/.test(trimmed)) return false;
  // Skip markdown table lines (have | as structure)
  if (trimmed.startsWith('|') && trimmed.endsWith('|')) return false;
  if (/^[\s|:-]+$/.test(trimmed) && /---/.test(trimmed)) return false;

  // Must have at least one comma, semicolon, or tab to be CSV-like
  const commas = (trimmed.match(/,/g) || []).length;
  const semicolons = (trimmed.match(/;/g) || []).length;
  const tabs = (trimmed.match(/\t/g) || []).length;

  return commas >= 1 || semicolons >= 1 || tabs >= 1;
}

/**
 * Scans text for CSV table blocks and splits content into text and CSV parts.
 * Lines inside code fences are ignored.
 */
export function detectCsvBlocks(text: string): CsvContentPart[] {
  const lines = text.split('\n');
  const parts: CsvContentPart[] = [];
  let textBuffer: string[] = [];
  let csvBuffer: string[] = [];
  let inCodeBlock = false;

  const flushText = () => {
    if (textBuffer.length > 0) {
      parts.push({ type: 'text', content: textBuffer.join('\n') });
      textBuffer = [];
    }
  };

  const flushCsv = () => {
    if (csvBuffer.length < 2) {
      // Not enough lines for CSV, push back to text
      textBuffer.push(...csvBuffer);
      csvBuffer = [];
      return;
    }

    const { valid, delimiter } = isCsvBlock(csvBuffer);
    if (valid && delimiter) {
      flushText();
      const rawContent = csvBuffer.join('\n');
      const headers = parseCsvLine(csvBuffer[0], delimiter);
      const rows = csvBuffer.slice(1).map(l => parseCsvLine(l, delimiter));
      parts.push({
        type: 'csv',
        table: { headers, rows, rawContent },
      });
    } else {
      // Not valid CSV, treat as regular text
      textBuffer.push(...csvBuffer);
    }
    csvBuffer = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track code fence state
    if (/^\s*(`{3,}|~{3,})/.test(line)) {
      flushCsv();
      inCodeBlock = !inCodeBlock;
      textBuffer.push(line);
      continue;
    }

    if (inCodeBlock) {
      textBuffer.push(line);
      continue;
    }

    // Empty line breaks CSV collection
    if (line.trim() === '') {
      flushCsv();
      textBuffer.push(line);
      continue;
    }

    if (isCsvCandidate(line)) {
      csvBuffer.push(line);
    } else {
      flushCsv();
      textBuffer.push(line);
    }
  }

  flushCsv();
  flushText();

  return parts;
}

/**
 * Quick check: does the text contain any CSV-like content?
 * Useful for early bailout before running full detection.
 */
export function mightContainCsv(text: string): boolean {
  const lines = text.split('\n').filter(l => l.trim() !== '');
  if (lines.length < 2) return false;

  let csvCandidateCount = 0;
  for (const line of lines) {
    if (isCsvCandidate(line)) {
      csvCandidateCount++;
      if (csvCandidateCount >= 2) return true;
    }
  }
  return false;
}
