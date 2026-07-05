import { describe, it, expect } from 'vitest';
import { detectGoal } from './goalDetector';

describe('goalDetector', () => {
  it('rejects short messages', async () => {
    const result = await detectGoal('hello');
    expect(result.isGoal).toBe(false);
  });

  it('rejects simple questions', async () => {
    const result = await detectGoal('What is logseq?');
    expect(result.isGoal).toBe(false);
  });

  it('rejects greetings', async () => {
    const result = await detectGoal('Hi there, how are you?');
    expect(result.isGoal).toBe(false);
  });

  it('rejects short questions ending with ?', async () => {
    const result = await detectGoal('Can you explain how RAG works?');
    expect(result.isGoal).toBe(false);
  });

  it('detects multi-step goal via regex fallback', async () => {
    const result = await detectGoal('Find all my project pages and then create a summary page from them');
    expect(result.isGoal).toBe(true);
  });

  it('does not false-trigger on hypothetical questions', async () => {
    const result = await detectGoal('What if I organize my files differently?');
    expect(result.isGoal).toBe(false);
  });
});
