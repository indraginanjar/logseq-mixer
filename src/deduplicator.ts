/**
 * Content deduplication for the embedding pipeline.
 * Removes duplicate block lines before chunking to avoid wasting token budget.
 */

/**
 * Remove duplicate block lines from a flat list.
 * Keeps the first occurrence, removes subsequent duplicates.
 * Uses exact string matching on the resolved text content.
 *
 * Validates: Requirements 5.2, 5.3, 5.4, 5.5
 */
export function deduplicateBlocks(blockLines: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const line of blockLines) {
    if (!seen.has(line)) {
      seen.add(line);
      result.push(line);
    }
  }

  return result;
}

/**
 * Cross-page deduplication for full indexing.
 * Tracks seen content across multiple pages.
 *
 * Validates: Requirements 5.1, 5.6
 */
export class CrossPageDeduplicator {
  private seen = new Set<string>();

  /**
   * Check if content was already seen. If not, mark it as seen.
   * @returns true if content is new (not seen before), false if duplicate
   */
  tryAdd(content: string): boolean {
    if (this.seen.has(content)) {
      return false;
    }
    this.seen.add(content);
    return true;
  }

  /** Reset for a new indexing run. */
  clear(): void {
    this.seen.clear();
  }
}
