import type { AgentConfig } from './AgentConfigStore';

/**
 * Resolve effective settings for an agent by merging agent overrides with global settings.
 * Agent-specific values take precedence; null/undefined falls back to global.
 */
export function resolveSettings(globalSettings: any, agentConfig: AgentConfig | null): any {
  if (!agentConfig) return globalSettings;

  return {
    ...globalSettings,
    // Agent overrides
    prompt: agentConfig.systemPrompt,
    selectedModel: agentConfig.model || globalSettings.selectedModel,
    chatProvider: agentConfig.provider || globalSettings.chatProvider,
    // Keep a reference to the agent config for downstream use
    __agentConfig: agentConfig,
  };
}

/**
 * Get the MCP tool states for the active agent.
 * Returns the agent's explicit overrides merged over global states.
 * If the agent has no explicit state for a tool, the global state applies.
 */
export function resolveToolStates(
  globalToolStates: Record<string, boolean>,
  agentConfig: AgentConfig | null
): Record<string, boolean> {
  if (!agentConfig || Object.keys(agentConfig.mcpToolStates).length === 0) {
    return globalToolStates;
  }
  // Agent overrides take precedence
  return { ...globalToolStates, ...agentConfig.mcpToolStates };
}

/**
 * Check if a specific tool is enabled for an agent.
 */
export function isToolEnabledForAgent(
  agentConfig: AgentConfig | null,
  globalToolStates: Record<string, boolean>,
  serverName: string,
  toolName: string
): boolean {
  const key = `${serverName}:${toolName}`;
  // If agent has an explicit state for this tool, use it
  if (agentConfig && key in agentConfig.mcpToolStates) {
    return agentConfig.mcpToolStates[key];
  }
  // Otherwise fall back to global tool states
  return globalToolStates[key] !== false;
}
