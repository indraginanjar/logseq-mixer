import { getActiveAgentId, setActiveAgentId, loadAgents } from './AgentConfigStore';
import type { AgentConfig } from './AgentConfigStore';

/** Key prefix for per-agent conversation history in localStorage. */
const HISTORY_KEY_PREFIX = 'logseq-mixer:history:';
/** Key prefix for per-agent UI chat messages in localStorage. */
const MESSAGES_KEY_PREFIX = 'logseq-mixer:chat-messages:';

/** Maximum size (in characters) for a single agent's stored conversation.
 *  ~500KB allows for substantial history while keeping total multi-agent
 *  usage well within the 5-10MB localStorage quota. */
const MAX_CONVERSATION_SIZE = 500_000;

/** Maximum number of messages to store per agent. */
const MAX_STORED_MESSAGES = 50;

export interface ConversationState {
  /** LLM-facing conversation history (role + content pairs). */
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** UI message objects for rendering. */
  messages: any[];
}

/**
 * Trim conversation state to stay within storage limits.
 * Keeps the most recent messages and history entries.
 */
function trimConversationState(state: ConversationState): ConversationState {
  const trimmedHistory = state.history.length > MAX_STORED_MESSAGES
    ? state.history.slice(-MAX_STORED_MESSAGES)
    : state.history;
  const trimmedMessages = state.messages.length > MAX_STORED_MESSAGES
    ? state.messages.slice(-MAX_STORED_MESSAGES)
    : state.messages;
  return { history: trimmedHistory, messages: trimmedMessages };
}

/**
 * Save the current agent's conversation state to localStorage.
 * Applies size limits and gracefully handles quota exceeded errors.
 */
export function saveConversationState(agentId: string, state: ConversationState): void {
  try {
    const trimmed = trimConversationState(state);
    const historyJson = JSON.stringify(trimmed.history);
    const messagesJson = JSON.stringify(trimmed.messages);

    // Check if serialized data exceeds our per-agent limit
    if (historyJson.length + messagesJson.length > MAX_CONVERSATION_SIZE) {
      // Progressively trim until it fits
      let h = trimmed.history;
      let m = trimmed.messages;
      while (JSON.stringify(h).length + JSON.stringify(m).length > MAX_CONVERSATION_SIZE && (h.length > 4 || m.length > 4)) {
        if (h.length > 4) h = h.slice(Math.ceil(h.length * 0.25));
        if (m.length > 4) m = m.slice(Math.ceil(m.length * 0.25));
      }
      localStorage.setItem(HISTORY_KEY_PREFIX + agentId, JSON.stringify(h));
      localStorage.setItem(MESSAGES_KEY_PREFIX + agentId, JSON.stringify(m));
    } else {
      localStorage.setItem(HISTORY_KEY_PREFIX + agentId, historyJson);
      localStorage.setItem(MESSAGES_KEY_PREFIX + agentId, messagesJson);
    }
  } catch (err: any) {
    // QuotaExceededError — try to save a minimal state
    if (err?.name === 'QuotaExceededError') {
      console.warn('[AgentSwitcher] localStorage quota exceeded, saving minimal state');
      try {
        const minimal = { history: state.history.slice(-6), messages: state.messages.slice(-6) };
        localStorage.setItem(HISTORY_KEY_PREFIX + agentId, JSON.stringify(minimal.history));
        localStorage.setItem(MESSAGES_KEY_PREFIX + agentId, JSON.stringify(minimal.messages));
      } catch {
        console.error('[AgentSwitcher] Cannot save conversation state even after trimming');
      }
    } else {
      console.warn('[AgentSwitcher] Failed to save conversation state:', err);
    }
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
