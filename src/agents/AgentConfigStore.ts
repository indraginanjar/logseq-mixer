export interface AgentConfig {
  id: string;
  name: string;
  description?: string;
  systemPrompt: string;
  model?: string | null;
  provider?: string | null;
  mcpToolStates: Record<string, boolean>;
  skillActivations: string[];
  createdAt: number;
  updatedAt: number;
  isDefault: boolean;
  icon: string;
}

const AGENTS_KEY = 'logseq-mixer:agents';
const ACTIVE_AGENT_KEY = 'logseq-mixer:active-agent';

/** Load all agents from localStorage. Returns empty array if none exist. */
export function loadAgents(): AgentConfig[] {
  try {
    const stored = localStorage.getItem(AGENTS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

/** Save agents array to localStorage. */
export function saveAgents(agents: AgentConfig[]): void {
  localStorage.setItem(AGENTS_KEY, JSON.stringify(agents));
}

/** Get the active agent ID from localStorage. */
export function getActiveAgentId(): string | null {
  return localStorage.getItem(ACTIVE_AGENT_KEY);
}

/** Set the active agent ID. */
export function setActiveAgentId(id: string): void {
  localStorage.setItem(ACTIVE_AGENT_KEY, id);
}

/** Get the active agent config. Falls back to default if not found. */
export function getActiveAgent(): AgentConfig | null {
  const id = getActiveAgentId();
  if (!id) return null;
  const agents = loadAgents();
  return agents.find(a => a.id === id) ?? agents.find(a => a.isDefault) ?? null;
}

/** Create a new agent. Validates name uniqueness. Returns the created agent. */
export function createAgent(partial: Omit<AgentConfig, 'id' | 'createdAt' | 'updatedAt'>): AgentConfig {
  const agents = loadAgents();
  if (agents.some(a => a.name.toLowerCase() === partial.name.toLowerCase())) {
    throw new Error(`Agent with name "${partial.name}" already exists`);
  }
  const agent: AgentConfig = {
    ...partial,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  agents.push(agent);
  saveAgents(agents);
  return agent;
}

/** Update an existing agent by ID. Validates name uniqueness if name changed. */
export function updateAgent(id: string, partial: Partial<Omit<AgentConfig, 'id' | 'createdAt'>>): AgentConfig {
  const agents = loadAgents();
  const idx = agents.findIndex(a => a.id === id);
  if (idx === -1) throw new Error(`Agent not found: ${id}`);
  if (partial.name && partial.name !== agents[idx].name) {
    if (agents.some(a => a.id !== id && a.name.toLowerCase() === partial.name!.toLowerCase())) {
      throw new Error(`Agent with name "${partial.name}" already exists`);
    }
  }
  agents[idx] = { ...agents[idx], ...partial, updatedAt: Date.now() };
  saveAgents(agents);
  return agents[idx];
}

/** Delete an agent by ID. Cannot delete the default agent. */
export function deleteAgent(id: string): void {
  const agents = loadAgents();
  const agent = agents.find(a => a.id === id);
  if (!agent) throw new Error(`Agent not found: ${id}`);
  if (agent.isDefault) throw new Error('Cannot delete the default agent');
  saveAgents(agents.filter(a => a.id !== id));
  // If this was the active agent, switch to default
  if (getActiveAgentId() === id) {
    const defaultAgent = loadAgents().find(a => a.isDefault);
    if (defaultAgent) setActiveAgentId(defaultAgent.id);
  }
}

/** Find an agent by name (case-insensitive). */
export function getAgentByName(name: string): AgentConfig | undefined {
  return loadAgents().find(a => a.name.toLowerCase() === name.toLowerCase());
}

/** Duplicate an agent. Creates a copy with "Copy of ..." name. */
export function duplicateAgent(id: string): AgentConfig {
  const agents = loadAgents();
  const source = agents.find(a => a.id === id);
  if (!source) throw new Error(`Agent not found: ${id}`);
  let newName = `Copy of ${source.name}`;
  let counter = 2;
  while (agents.some(a => a.name.toLowerCase() === newName.toLowerCase())) {
    newName = `Copy of ${source.name} (${counter})`;
    counter++;
  }
  return createAgent({
    name: newName,
    description: source.description,
    systemPrompt: source.systemPrompt,
    model: source.model,
    provider: source.provider,
    mcpToolStates: { ...source.mcpToolStates },
    skillActivations: [...source.skillActivations],
    isDefault: false,
    icon: source.icon,
  });
}

/** Create the built-in default agent from current settings. */
export function createDefaultAgent(currentPrompt: string): AgentConfig {
  return createAgent({
    name: 'Default',
    description: 'The default assistant',
    systemPrompt: currentPrompt,
    model: null,
    provider: null,
    mcpToolStates: {},
    skillActivations: [],
    isDefault: true,
    icon: '🤖',
  });
}
