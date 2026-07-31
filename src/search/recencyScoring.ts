/**
 * Recency scoring for retrieval results.
 * Boosts chunks from more recent pages based on their note_date header.
 */

/** Extract note_date from a chunk's content header. Returns null if not found. */
export function extractNoteDate(content: string): Date | null {
  const match = content.match(/note_date:\s*(\d{4}-\d{2}-\d{2})/);
  if (!match) return null;
  const date = new Date(match[1] + 'T00:00:00Z');
  return isNaN(date.getTime()) ? null : date;
}

/**
 * Compute a recency weight for a given date relative to today.
 * Returns a multiplier:
 * - Standard: 1.3 (today) decaying to 0.7 (60+ days)
 * - Temporal boost: 1.5 (today) decaying to 0.6 (60+ days)
 *
 * Chunks without dates (non-journal pages) should not have this applied.
 */
export function computeRecencyWeight(noteDate: Date, now: Date = new Date(), temporalBoost: boolean = false): number {
  const msPerDay = 86400000;
  const daysOld = Math.max(0, Math.floor((now.getTime() - noteDate.getTime()) / msPerDay));

  if (temporalBoost) {
    // Stronger decay for temporal queries: 1.5 for today, decays to 0.6
    return Math.max(0.6, 1.5 - daysOld * 0.015);
  }

  // Standard recency: 1.3 for today, decays to 0.7
  return Math.max(0.7, 1.3 - daysOld * 0.01);
}

/** Apply recency weighting to RRF scores in-place.
 * Only affects chunks that have a parseable note_date in their content.
 * Chunks without dates (non-journal pages) are unaffected (weight = 1.0).
 */
export function applyRecencyScoring(
  hits: Array<{ content: string; rrfScore: number }>,
  temporalBoost: boolean = false
): void {
  const now = new Date();
  for (const hit of hits) {
    const noteDate = extractNoteDate(hit.content);
    if (noteDate) {
      const weight = computeRecencyWeight(noteDate, now, temporalBoost);
      hit.rrfScore *= weight;
    }
  }
}
