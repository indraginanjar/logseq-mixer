import { describe, expect, it } from 'vitest';
import { extractNoteDate, computeRecencyWeight, applyRecencyScoring } from './recencyScoring';

describe('extractNoteDate', () => {
  it('extracts date from valid note_date header', () => {
    const content = 'note_id: 123\nnote_name: Test\nnote_date: 2026-07-28\nnote_content:\n\nHello';
    const result = extractNoteDate(content);
    expect(result).not.toBeNull();
    expect(result!.toISOString().startsWith('2026-07-28')).toBe(true);
  });

  it('returns null when no note_date present', () => {
    const content = 'note_id: 123\nnote_name: Test\nnote_type: page\nnote_content:\n\nHello';
    expect(extractNoteDate(content)).toBeNull();
  });

  it('returns null for invalid date format', () => {
    const content = 'note_date: not-a-date\nnote_content:\n\nHello';
    expect(extractNoteDate(content)).toBeNull();
  });

  it('handles date with extra whitespace', () => {
    const content = 'note_date:  2026-01-15\nnote_content:\n\n';
    const result = extractNoteDate(content);
    expect(result).not.toBeNull();
    expect(result!.toISOString().startsWith('2026-01-15')).toBe(true);
  });
});

describe('computeRecencyWeight', () => {
  const today = new Date('2026-07-28T12:00:00');

  it('returns 1.3 for today (standard)', () => {
    const noteDate = new Date('2026-07-28T00:00:00');
    expect(computeRecencyWeight(noteDate, today, false)).toBe(1.3);
  });

  it('returns 1.5 for today (temporal boost)', () => {
    const noteDate = new Date('2026-07-28T00:00:00');
    expect(computeRecencyWeight(noteDate, today, true)).toBe(1.5);
  });

  it('decays over time (standard)', () => {
    const oneWeekAgo = new Date('2026-07-21T00:00:00');
    const weight = computeRecencyWeight(oneWeekAgo, today, false);
    expect(weight).toBeCloseTo(1.23, 1);
  });

  it('decays over time (temporal boost)', () => {
    const oneWeekAgo = new Date('2026-07-21T00:00:00');
    const weight = computeRecencyWeight(oneWeekAgo, today, true);
    expect(weight).toBeCloseTo(1.395, 1);
  });

  it('floors at 0.7 for old dates (standard)', () => {
    const old = new Date('2026-01-01T00:00:00');
    expect(computeRecencyWeight(old, today, false)).toBe(0.7);
  });

  it('floors at 0.6 for old dates (temporal boost)', () => {
    const old = new Date('2026-01-01T00:00:00');
    expect(computeRecencyWeight(old, today, true)).toBe(0.6);
  });
});

describe('applyRecencyScoring', () => {
  it('boosts rrfScore for chunks with note_date', () => {
    const hits = [
      { content: 'note_date: 2026-07-28\nnote_content:\n\nHello', rrfScore: 0.1 },
      { content: 'note_type: page\nnote_content:\n\nWorld', rrfScore: 0.1 },
    ];
    applyRecencyScoring(hits, false);
    // First hit should be boosted (has date = today-ish)
    expect(hits[0].rrfScore).toBeGreaterThan(0.1);
    // Second hit unchanged (no date)
    expect(hits[1].rrfScore).toBe(0.1);
  });

  it('applies stronger boost with temporalBoost=true', () => {
    const hits1 = [{ content: 'note_date: 2026-07-28\nnote_content:\n\n', rrfScore: 0.1 }];
    const hits2 = [{ content: 'note_date: 2026-07-28\nnote_content:\n\n', rrfScore: 0.1 }];
    applyRecencyScoring(hits1, false);
    applyRecencyScoring(hits2, true);
    expect(hits2[0].rrfScore).toBeGreaterThan(hits1[0].rrfScore);
  });
});
