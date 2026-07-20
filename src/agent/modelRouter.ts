import type { AgentStep } from './types';

/**
 * Resolve which model to use for a given step.
 * Priority: explicit step.model → type-based routing → main model fallback.
 */
export function resolveModelForStep(step: AgentStep, settings: any): string {
  const mainModel = settings.selectedModel || 'gpt-4o';
  const fastModel = settings.agentFastModel?.trim() || '';

  // Explicit model override on the step
  if (step.model) {
    if (step.model === 'fast') return fastModel || mainModel;
    if (step.model === 'quality') return mainModel;
    return step.model; // Assume it's a literal model name
  }

  // Type-based routing: lightweight tasks use fast model if configured
  if (fastModel && (step.type === 'gather' || step.type === 'read')) {
    return fastModel;
  }

  // Quality-critical tasks always use main model
  // specialist, subgoal, think, write, search, tool → main model
  return mainModel;
}
