import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  loadAgents,
  saveAgents,
  getActiveAgentId,
  setActiveAgentId,
  getActiveAgent,
  createAgent,
  updateAgent,
  deleteAgent,
  getAgentByName,
  duplicateAgent,
  createDefaultAgent,
  AgentConfig,
} from './AgentConfigStore';

describe('AgentConfigStore', () => {
  let storage: Record<string, string> = {};

  beforeEach(() => {
    storage = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, value: string) => { storage[key] = value; },
      removeItem: (key: string) => { delete storage[key]; },
    });
    // Also mock crypto.randomUUID
    vi.stubGlobal('crypto', { randomUUID: () => Math.random().toString(36).slice(2) });
  });

  describe('loadAgents', () => {
    it('returns empty array when nothing stored', () => {
      expect(loadAgents()).toEqual([]);
    });

    it('returns parsed agents from localStorage', () => {
      const agents: AgentConfig[] = [{
        id: 'test-id',
        name: 'Test',
        systemPrompt: 'Hello',
        mcpToolStates: {},
        skillActivations: [],
        createdAt: 1000,
        updatedAt: 1000,
        isDefault: false,
        icon: '🤖',
      }];
      storage['logseq-mixer:agents'] = JSON.stringify(agents);
      expect(loadAgents()).toEqual(agents);
    });

    it('returns empty array on invalid JSON', () => {
      storage['logseq-mixer:agents'] = 'not-valid-json{{{';
      expect(loadAgents()).toEqual([]);
    });
  });

  describe('saveAgents', () => {
    it('saves agents to localStorage', () => {
      const agents: AgentConfig[] = [{
        id: 'test-id',
        name: 'Test',
        systemPrompt: 'Hello',
        mcpToolStates: {},
        skillActivations: [],
        createdAt: 1000,
        updatedAt: 1000,
        isDefault: false,
        icon: '🤖',
      }];
      saveAgents(agents);
      expect(JSON.parse(storage['logseq-mixer:agents'])).toEqual(agents);
    });
  });

  describe('getActiveAgentId / setActiveAgentId', () => {
    it('returns null when no active agent set', () => {
      expect(getActiveAgentId()).toBeNull();
    });

    it('returns the stored active agent ID', () => {
      setActiveAgentId('agent-123');
      expect(getActiveAgentId()).toBe('agent-123');
    });
  });

  describe('getActiveAgent', () => {
    it('returns null when no active agent ID is set', () => {
      expect(getActiveAgent()).toBeNull();
    });

    it('returns the agent matching the active ID', () => {
      const agent = createDefaultAgent('system prompt');
      setActiveAgentId(agent.id);
      const result = getActiveAgent();
      expect(result).not.toBeNull();
      expect(result!.id).toBe(agent.id);
    });

    it('falls back to default agent if active ID not found', () => {
      const defaultAgent = createDefaultAgent('system prompt');
      setActiveAgentId('non-existent-id');
      const result = getActiveAgent();
      expect(result).not.toBeNull();
      expect(result!.id).toBe(defaultAgent.id);
      expect(result!.isDefault).toBe(true);
    });
  });

  describe('createAgent', () => {
    it('creates an agent with generated id and timestamps', () => {
      const agent = createAgent({
        name: 'My Agent',
        description: 'A test agent',
        systemPrompt: 'Be helpful',
        model: 'gpt-4',
        provider: 'openai',
        mcpToolStates: { search: true },
        skillActivations: ['skill-1'],
        isDefault: false,
        icon: '🧠',
      });

      expect(agent.id).toBeDefined();
      expect(agent.id.length).toBeGreaterThan(0);
      expect(agent.name).toBe('My Agent');
      expect(agent.description).toBe('A test agent');
      expect(agent.systemPrompt).toBe('Be helpful');
      expect(agent.model).toBe('gpt-4');
      expect(agent.provider).toBe('openai');
      expect(agent.mcpToolStates).toEqual({ search: true });
      expect(agent.skillActivations).toEqual(['skill-1']);
      expect(agent.isDefault).toBe(false);
      expect(agent.icon).toBe('🧠');
      expect(agent.createdAt).toBeGreaterThan(0);
      expect(agent.updatedAt).toBeGreaterThan(0);
    });

    it('persists the created agent in localStorage', () => {
      createAgent({
        name: 'Persisted',
        systemPrompt: 'test',
        mcpToolStates: {},
        skillActivations: [],
        isDefault: false,
        icon: '🤖',
      });
      const agents = loadAgents();
      expect(agents).toHaveLength(1);
      expect(agents[0].name).toBe('Persisted');
    });

    it('throws on duplicate name (case-insensitive)', () => {
      createAgent({
        name: 'UniqueAgent',
        systemPrompt: 'test',
        mcpToolStates: {},
        skillActivations: [],
        isDefault: false,
        icon: '🤖',
      });
      expect(() => createAgent({
        name: 'uniqueagent',
        systemPrompt: 'test2',
        mcpToolStates: {},
        skillActivations: [],
        isDefault: false,
        icon: '🤖',
      })).toThrow('Agent with name "uniqueagent" already exists');
    });

    it('allows different names', () => {
      createAgent({
        name: 'Agent A',
        systemPrompt: 'test',
        mcpToolStates: {},
        skillActivations: [],
        isDefault: false,
        icon: '🤖',
      });
      const agentB = createAgent({
        name: 'Agent B',
        systemPrompt: 'test2',
        mcpToolStates: {},
        skillActivations: [],
        isDefault: false,
        icon: '🤖',
      });
      expect(agentB.name).toBe('Agent B');
      expect(loadAgents()).toHaveLength(2);
    });
  });

  describe('updateAgent', () => {
    it('updates agent fields and updatedAt timestamp', () => {
      const agent = createAgent({
        name: 'Original',
        systemPrompt: 'old prompt',
        mcpToolStates: {},
        skillActivations: [],
        isDefault: false,
        icon: '🤖',
      });
      const originalUpdatedAt = agent.updatedAt;

      // Small delay to ensure timestamp difference
      const updated = updateAgent(agent.id, {
        systemPrompt: 'new prompt',
        icon: '🧪',
      });

      expect(updated.systemPrompt).toBe('new prompt');
      expect(updated.icon).toBe('🧪');
      expect(updated.name).toBe('Original');
      expect(updated.updatedAt).toBeGreaterThanOrEqual(originalUpdatedAt);
    });

    it('throws if agent not found', () => {
      expect(() => updateAgent('non-existent', { name: 'X' })).toThrow('Agent not found: non-existent');
    });

    it('throws on duplicate name when renaming', () => {
      createAgent({
        name: 'Agent A',
        systemPrompt: 'test',
        mcpToolStates: {},
        skillActivations: [],
        isDefault: false,
        icon: '🤖',
      });
      const agentB = createAgent({
        name: 'Agent B',
        systemPrompt: 'test',
        mcpToolStates: {},
        skillActivations: [],
        isDefault: false,
        icon: '🤖',
      });
      expect(() => updateAgent(agentB.id, { name: 'Agent A' })).toThrow(
        'Agent with name "Agent A" already exists'
      );
    });

    it('allows keeping the same name', () => {
      const agent = createAgent({
        name: 'Same Name',
        systemPrompt: 'test',
        mcpToolStates: {},
        skillActivations: [],
        isDefault: false,
        icon: '🤖',
      });
      const updated = updateAgent(agent.id, { name: 'Same Name', systemPrompt: 'updated' });
      expect(updated.systemPrompt).toBe('updated');
    });

    it('persists updates to localStorage', () => {
      const agent = createAgent({
        name: 'Persist Test',
        systemPrompt: 'test',
        mcpToolStates: {},
        skillActivations: [],
        isDefault: false,
        icon: '🤖',
      });
      updateAgent(agent.id, { description: 'added description' });
      const agents = loadAgents();
      expect(agents[0].description).toBe('added description');
    });
  });

  describe('deleteAgent', () => {
    it('removes an agent from storage', () => {
      const agent = createAgent({
        name: 'ToDelete',
        systemPrompt: 'test',
        mcpToolStates: {},
        skillActivations: [],
        isDefault: false,
        icon: '🤖',
      });
      expect(loadAgents()).toHaveLength(1);
      deleteAgent(agent.id);
      expect(loadAgents()).toHaveLength(0);
    });

    it('throws if agent not found', () => {
      expect(() => deleteAgent('non-existent')).toThrow('Agent not found: non-existent');
    });

    it('throws when trying to delete default agent', () => {
      const defaultAgent = createDefaultAgent('system prompt');
      expect(() => deleteAgent(defaultAgent.id)).toThrow('Cannot delete the default agent');
    });

    it('switches active agent to default when deleting active agent', () => {
      const defaultAgent = createDefaultAgent('system prompt');
      const otherAgent = createAgent({
        name: 'Other',
        systemPrompt: 'test',
        mcpToolStates: {},
        skillActivations: [],
        isDefault: false,
        icon: '🧪',
      });
      setActiveAgentId(otherAgent.id);
      expect(getActiveAgentId()).toBe(otherAgent.id);

      deleteAgent(otherAgent.id);
      expect(getActiveAgentId()).toBe(defaultAgent.id);
    });

    it('does not change active agent when deleting non-active agent', () => {
      const defaultAgent = createDefaultAgent('system prompt');
      const otherAgent = createAgent({
        name: 'Other',
        systemPrompt: 'test',
        mcpToolStates: {},
        skillActivations: [],
        isDefault: false,
        icon: '🧪',
      });
      setActiveAgentId(defaultAgent.id);

      deleteAgent(otherAgent.id);
      expect(getActiveAgentId()).toBe(defaultAgent.id);
    });
  });

  describe('getAgentByName', () => {
    it('returns undefined when no agents exist', () => {
      expect(getAgentByName('Test')).toBeUndefined();
    });

    it('finds agent by exact name', () => {
      const agent = createAgent({
        name: 'FindMe',
        systemPrompt: 'test',
        mcpToolStates: {},
        skillActivations: [],
        isDefault: false,
        icon: '🤖',
      });
      const found = getAgentByName('FindMe');
      expect(found).toBeDefined();
      expect(found!.id).toBe(agent.id);
    });

    it('finds agent case-insensitively', () => {
      createAgent({
        name: 'CaseSensitive',
        systemPrompt: 'test',
        mcpToolStates: {},
        skillActivations: [],
        isDefault: false,
        icon: '🤖',
      });
      expect(getAgentByName('casesensitive')).toBeDefined();
      expect(getAgentByName('CASESENSITIVE')).toBeDefined();
      expect(getAgentByName('CaseSensitive')).toBeDefined();
    });

    it('returns undefined for non-existent name', () => {
      createAgent({
        name: 'Exists',
        systemPrompt: 'test',
        mcpToolStates: {},
        skillActivations: [],
        isDefault: false,
        icon: '🤖',
      });
      expect(getAgentByName('DoesNotExist')).toBeUndefined();
    });
  });

  describe('duplicateAgent', () => {
    it('creates a copy with "Copy of" prefix', () => {
      const original = createAgent({
        name: 'Original',
        description: 'desc',
        systemPrompt: 'prompt',
        model: 'gpt-4',
        provider: 'openai',
        mcpToolStates: { tool1: true },
        skillActivations: ['skill-a'],
        isDefault: false,
        icon: '🧠',
      });

      const copy = duplicateAgent(original.id);
      expect(copy.name).toBe('Copy of Original');
      expect(copy.description).toBe('desc');
      expect(copy.systemPrompt).toBe('prompt');
      expect(copy.model).toBe('gpt-4');
      expect(copy.provider).toBe('openai');
      expect(copy.mcpToolStates).toEqual({ tool1: true });
      expect(copy.skillActivations).toEqual(['skill-a']);
      expect(copy.isDefault).toBe(false);
      expect(copy.icon).toBe('🧠');
      expect(copy.id).not.toBe(original.id);
    });

    it('increments counter when "Copy of" name already exists', () => {
      const original = createAgent({
        name: 'Original',
        systemPrompt: 'test',
        mcpToolStates: {},
        skillActivations: [],
        isDefault: false,
        icon: '🤖',
      });

      const copy1 = duplicateAgent(original.id);
      expect(copy1.name).toBe('Copy of Original');

      const copy2 = duplicateAgent(original.id);
      expect(copy2.name).toBe('Copy of Original (2)');

      const copy3 = duplicateAgent(original.id);
      expect(copy3.name).toBe('Copy of Original (3)');
    });

    it('throws if source agent not found', () => {
      expect(() => duplicateAgent('non-existent')).toThrow('Agent not found: non-existent');
    });

    it('does not mutate the original agent mcpToolStates', () => {
      const original = createAgent({
        name: 'Immutable',
        systemPrompt: 'test',
        mcpToolStates: { tool: true },
        skillActivations: ['s1'],
        isDefault: false,
        icon: '🤖',
      });

      const copy = duplicateAgent(original.id);
      copy.mcpToolStates['newTool'] = false;
      copy.skillActivations.push('s2');

      const reloaded = loadAgents().find(a => a.id === original.id)!;
      expect(reloaded.mcpToolStates).toEqual({ tool: true });
      expect(reloaded.skillActivations).toEqual(['s1']);
    });
  });

  describe('createDefaultAgent', () => {
    it('creates a default agent with correct properties', () => {
      const agent = createDefaultAgent('You are a helpful assistant');
      expect(agent.name).toBe('Default');
      expect(agent.description).toBe('The default assistant');
      expect(agent.systemPrompt).toBe('You are a helpful assistant');
      expect(agent.model).toBeNull();
      expect(agent.provider).toBeNull();
      expect(agent.mcpToolStates).toEqual({});
      expect(agent.skillActivations).toEqual([]);
      expect(agent.isDefault).toBe(true);
      expect(agent.icon).toBe('🤖');
    });

    it('cannot create two default agents with same name', () => {
      createDefaultAgent('prompt 1');
      expect(() => createDefaultAgent('prompt 2')).toThrow(
        'Agent with name "Default" already exists'
      );
    });
  });
});
