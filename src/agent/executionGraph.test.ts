import { describe, it, expect } from 'vitest';
import { buildExecutionWaves } from './executionGraph';
import type { AgentStep } from './types';

function step(id: number, dependsOn?: number[]): AgentStep {
  return { id, description: `step ${id}`, type: 'think', status: 'pending', dependsOn };
}

describe('buildExecutionWaves', () => {
  it('returns sequential waves when no dependencies present', () => {
    const steps = [step(1), step(2), step(3)];
    const waves = buildExecutionWaves(steps);
    expect(waves).toHaveLength(3);
    expect(waves[0]).toHaveLength(1);
    expect(waves[0][0].id).toBe(1);
  });

  it('groups independent steps into the same wave', () => {
    const steps = [step(1, []), step(2, []), step(3, [1, 2])];
    const waves = buildExecutionWaves(steps);
    expect(waves).toHaveLength(2);
    expect(waves[0].map(s => s.id).sort()).toEqual([1, 2]);
    expect(waves[1].map(s => s.id)).toEqual([3]);
  });

  it('handles multi-level dependencies', () => {
    const steps = [step(1, []), step(2, [1]), step(3, [2]), step(4, [1])];
    const waves = buildExecutionWaves(steps);
    expect(waves).toHaveLength(3);
    expect(waves[0].map(s => s.id)).toEqual([1]);
    expect(waves[1].map(s => s.id).sort()).toEqual([2, 4]);
    expect(waves[2].map(s => s.id)).toEqual([3]);
  });

  it('throws on circular dependencies', () => {
    const steps = [step(1, [2]), step(2, [1])];
    expect(() => buildExecutionWaves(steps)).toThrow('Circular dependency');
  });

  it('throws when dependency references non-existent step', () => {
    const steps = [step(1, [99])];
    // step 99 never completes so step 1 can never be ready
    expect(() => buildExecutionWaves(steps)).toThrow('Circular dependency');
  });

  it('handles single step with no deps', () => {
    const steps = [step(1)];
    const waves = buildExecutionWaves(steps);
    expect(waves).toHaveLength(1);
    expect(waves[0][0].id).toBe(1);
  });

  it('handles empty steps array', () => {
    const waves = buildExecutionWaves([]);
    expect(waves).toHaveLength(0);
  });

  it('complex diamond dependency graph', () => {
    // 1 -> 2, 3 -> 4 (diamond)
    const steps = [step(1, []), step(2, [1]), step(3, [1]), step(4, [2, 3])];
    const waves = buildExecutionWaves(steps);
    expect(waves).toHaveLength(3);
    expect(waves[0].map(s => s.id)).toEqual([1]);
    expect(waves[1].map(s => s.id).sort()).toEqual([2, 3]);
    expect(waves[2].map(s => s.id)).toEqual([4]);
  });
});
