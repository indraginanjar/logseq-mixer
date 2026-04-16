export type QueryCategory = 'keyword' | 'semantic' | 'mixed';

export interface ClassificationResult {
  category: QueryCategory;
  bm25Weight: number;
  vectorWeight: number;
}

const WEIGHT_MAP: Record<QueryCategory, { bm25Weight: number; vectorWeight: number }> = {
  keyword: { bm25Weight: 1.5, vectorWeight: 0.5 },
  mixed: { bm25Weight: 1, vectorWeight: 1 },
  semantic: { bm25Weight: 0.5, vectorWeight: 1.5 },
};

/** Detect URL patterns: http://, https://, ftp://, or domain-like (e.g., example.com) */
function hasUrlPattern(query: string): boolean {
  return /(?:https?|ftp):\/\//.test(query) || /\b[a-z0-9-]+\.[a-z]{2,}\b/i.test(query);
}

/** Detect file paths: /path/to/file, C:\path, ./relative */
function hasFilePath(query: string): boolean {
  return /(?:^|\s)[.~]?\/\w/.test(query) || /[A-Z]:\\/.test(query);
}

/** Detect code-like tokens: camelCase, snake_case, method calls (foo.bar), brackets/braces */
function hasCodeTokens(query: string): boolean {
  // camelCase: lowercase followed by uppercase
  if (/[a-z][A-Z]/.test(query)) return true;
  // snake_case: word_word
  if (/\b\w+_\w+\b/.test(query)) return true;
  // method calls: word.word (but not domain-like which is caught by URL check)
  if (/\b\w+\.\w+\(/.test(query)) return true;
  // brackets/braces
  if (/[[\]{}()]/.test(query)) return true;
  return false;
}

/** Detect quoted phrases: text in single or double quotes */
function hasQuotedPhrase(query: string): boolean {
  return /["'][^"']+["']/.test(query);
}

/** Detect special characters: regex-like patterns, *, ?, ^, etc. */
function hasSpecialCharacters(query: string): boolean {
  return /[*?^$|\\]/.test(query);
}

export function classifyQuery(query: string): ClassificationResult {
  let indicatorCount = 0;

  if (hasUrlPattern(query)) indicatorCount++;
  if (hasFilePath(query)) indicatorCount++;
  if (hasCodeTokens(query)) indicatorCount++;
  if (hasQuotedPhrase(query)) indicatorCount++;
  if (hasSpecialCharacters(query)) indicatorCount++;

  let category: QueryCategory;
  if (indicatorCount >= 2) {
    category = 'keyword';
  } else if (indicatorCount === 1) {
    category = 'mixed';
  } else {
    category = 'semantic';
  }

  return {
    category,
    ...WEIGHT_MAP[category],
  };
}
