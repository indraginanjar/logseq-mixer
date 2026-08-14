import { getActiveAgentId, setActiveAgentId, loadAgents } from './AgentConfigStore';
import type { AgentConfig } from './AgentConfigStore';

/** Key prefix for per-agent conversation history in localStorage. */
const HISTORY_KEY_PREFIX = 'logseq-mixer:history:';
/** Key prefix for per-agent UI chat messages in localStorage. */
const MESSAGES_KEY_PREFIX = 'logseq-mixer:chat-messages:';

export interface ConversationState {
  /** LLM-facing conversation history (role + content pairs). */
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** UI message objects for rendering. */
  messages: any[];
}

/**
 * Save the current agent's conversation state to localStorage.
 */
export function saveConversationState(agentId: string, state: ConversationState): void {
  try {
    localStorage.setItem(HISTORY_KEY_PREFIX + agentId, JSON.stringify(state.history));
    localStorage.setItem(MESSAGES_KEY_PREFIX + agentId, JSON.stringify(state.messages));
  } catch (err) {
    console.warn('[AgentSwitcher] Failed to save conversation state:', err);
  }
}

/**
 * Load an agent's conversation state from localStorage.
 * Returns empty state if nothing is stored.
 */
export function loadConversationState(agentId: string): ConversationState {
  try {
    const historyRaw = localStorage.getItem(HISTORY_KEY_PREFIX + agentId);
    const messagesRaw = localStorage.getItem(MESSAGES_KEY_PREFIX + agentId);
    return {
      history: historyRaw ? JSON.parse(historyRaw) : [],
      messages: messagesRaw ? JSON.parse(messagesRaw) : [],
    };
  } catch {
    return { history: [], messages: [] };
  }
}

/**
 * Clear an agent's stored conversation state.
 * Used when starting a new session or deleting an agent.
 */
export function clearConversationState(agentId: string): void {
  localStorage.removeItem(HISTORY_KEY_PREFIX + agentId);
  localStorage.removeItem(MESSAGES_KEY_PREFIX + agentId);
}

/**
 * Perform an agent switch.
 * Saves current agent's state, updates active agent, and returns the new agent's state.
 *
 * @param currentState - The current conversation state to save
 * @param targetAgentId - The agent to switch to
 * @returns The target agent's conversation state and config
 */
export function switchAgent(
  currentState: ConversationState,
  targetAgentId: string
): { state: ConversationState; agent: AgentConfig } {
  const currentAgentId = getActiveAgentId();
  const agents = loadAgents();
  const targetAgent = agents.find(a => a.id === targetAgentId);

  if (!targetAgent) {
    throw new Error(`Target agent not found: ${targetAgentId}`);
  }

  // Save current agent's state (if we have a current agent)
  if (currentAgentId) {
    saveConversationState(currentAgentId, currentState);
  }

  // Update active agent
  setActiveAgentId(targetAgentId);

  // Load target agent's state
  const targetState = loadConversationState(targetAgentId);

  return { state: targetState, agent: targetAgent };
}
