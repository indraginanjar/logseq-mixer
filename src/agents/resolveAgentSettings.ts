import type { AgentConfig } from './AgentConfigStore';

/** Valid provider identifiers that the system supports. */
const VALID_PROVIDERS = ['openai', 'ollama', 'litellm'];

/**
 * Resolve effective settings for an agent by merging agent overrides with global settings.
 * Agent-specific values take precedence; null/undefined falls back to global.
 * Validates agent model/provider and falls back to global if invalid.
 */
export function resolveSettings(globalSettings: any, agentConfig: AgentConfig | null): any {
  if (!agentConfig) return globalSettings;

  // Validate provider if specified
  let resolvedProvider = globalSettings.chatProvider;
  if (agentConfig.provider) {
    if (VALID_PROVIDERS.includes(agentConfig.provider)) {
      resolvedProvider = agentConfig.provider;
    } else {
      console.warn(`[resolveSettings] Agent "${agentConfig.name}" has invalid provider "${agentConfig.provider}", falling back to global provider "${globalSettings.chatProvider}"`);
    }
  }

  // Validate model if specified (basic sanity: non-empty string, no whitespace-only)
  let resolvedModel = globalSettings.selectedModel;
  if (agentConfig.model) {
    const trimmedModel = agentConfig.model.trim();
    if (trimmedModel.length > 0 && trimmedModel.length <= 200) {
      resolvedModel = trimmedModel;
    } else {
      console.warn(`[resolveSettings] Agent "${agentConfig.name}" has invalid model "${agentConfig.model}", falling back to global model "${globalSettings.selectedModel}"`);
    }
  }

  return {
    ...globalSettings,
    // Agent overrides (validated)
    prompt: agentConfig.systemPrompt,
    selectedModel: resolvedModel,
    chatProvider: resolvedProvider,
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
