import type { AgentStep } from './types';

/**
 * Group steps into execution waves based on their dependencies.
 * Steps in the same wave can run concurrently.
 *
 * If no steps have dependsOn fields, returns each step in its own wave (sequential execution).
 */
export function buildExecutionWaves(steps: AgentStep[]): AgentStep[][] {
  // If no step has dependencies, fall back to sequential
  const hasDeps = steps.some(s => s.dependsOn && s.dependsOn.length > 0);
  if (!hasDeps) {
    return steps.map(s => [s]);
  }

  const completed = new Set<number>();
  const remaining = [...steps];
  const waves: AgentStep[][] = [];

  // Safety limit to prevent infinite loops from circular deps
  const maxIterations = steps.length;
  let iterations = 0;

  while (remaining.length > 0) {
    iterations++;
    if (iterations > maxIterations) {
      throw new Error('Circular dependency detected in execution graph');
    }

    // Find steps whose dependencies are all satisfied
    const ready: AgentStep[] = [];
    const notReady: AgentStep[] = [];

    for (const step of remaining) {
      const deps = step.dependsOn || [];
      if (deps.every(d => completed.has(d))) {
        ready.push(step);
      } else {
        notReady.push(step);
      }
    }

    if (ready.length === 0) {
      // All remaining steps have unmet deps — circular dependency
      throw new Error('Circular dependency detected in execution graph');
    }

    waves.push(ready);
    for (const step of ready) {
      completed.add(step.id);
    }
    remaining.length = 0;
    remaining.push(...notReady);
  }

  return waves;
}
