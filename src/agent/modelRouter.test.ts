import { describe, it, expect } from 'vitest';
import { resolveModelForStep } from './modelRouter';
import type { AgentStep } from './types';

function makeStep(overrides: Partial<AgentStep> = {}): AgentStep {
  return { id: 1, description: 'test', type: 'think', status: 'pending', ...overrides };
}

describe('resolveModelForStep', () => {
  const settings = { selectedModel: 'gpt-4o', agentFastModel: 'gpt-4o-mini' };
  const settingsNoFast = { selectedModel: 'gpt-4o', agentFastModel: '' };

  it('returns main model for think steps', () => {
    expect(resolveModelForStep(makeStep({ type: 'think' }), settings)).toBe('gpt-4o');
  });

  it('returns fast model for gather steps when configured', () => {
    expect(resolveModelForStep(makeStep({ type: 'gather' }), settings)).toBe('gpt-4o-mini');
  });

  it('returns fast model for read steps when configured', () => {
    expect(resolveModelForStep(makeStep({ type: 'read' }), settings)).toBe('gpt-4o-mini');
  });

  it('returns main model for gather when no fast model configured', () => {
    expect(resolveModelForStep(makeStep({ type: 'gather' }), settingsNoFast)).toBe('gpt-4o');
  });

  it('returns main model for specialist steps', () => {
    expect(resolveModelForStep(makeStep({ type: 'specialist' }), settings)).toBe('gpt-4o');
  });

  it('returns main model for write steps', () => {
    expect(resolveModelForStep(makeStep({ type: 'write' }), settings)).toBe('gpt-4o');
  });

  it('resolves explicit model="fast" to agentFastModel', () => {
    expect(resolveModelForStep(makeStep({ model: 'fast' }), settings)).toBe('gpt-4o-mini');
  });

  it('resolves model="fast" to main model when no fast model configured', () => {
    expect(resolveModelForStep(makeStep({ model: 'fast' }), settingsNoFast)).toBe('gpt-4o');
  });

  it('resolves model="quality" to main model always', () => {
    expect(resolveModelForStep(makeStep({ model: 'quality' }), settings)).toBe('gpt-4o');
  });

  it('uses literal model name when step.model is a specific model', () => {
    expect(resolveModelForStep(makeStep({ model: 'claude-3-opus' }), settings)).toBe('claude-3-opus');
  });

  it('explicit step.model overrides type-based routing', () => {
    expect(resolveModelForStep(makeStep({ type: 'gather', model: 'quality' }), settings)).toBe('gpt-4o');
  });
});
