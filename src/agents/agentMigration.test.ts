import { describe, it, expect, beforeEach, vi } from 'vitest';
import initSqlJs, { Database } from 'sql.js';
import { migrateToMultiAgent, ensureAgentIdColumns } from './agentMigration';

const AGENTS_KEY = 'logseq-mixer:agents';
const ACTIVE_AGENT_KEY = 'logseq-mixer:active-agent';

let storage: Record<string, string> = {};

beforeEach(() => {
  storage = {};
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage[key] ?? null,
    setItem: (key: string, value: string) => { storage[key] = value; },
    removeItem: (key: string) => { delete storage[key]; },
  });
  vi.stubGlobal('crypto', { randomUUID: () => Math.random().toString(36).slice(2) });
});

async function createTestDb(): Promise<Database> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(`CREATE TABLE IF NOT EXISTS agent_memory (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_accessed INTEGER,
    source TEXT,
    metadata TEXT
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS token_usage (
    id TEXT PRIMARY KEY,
    timestamp INTEGER NOT NULL,
    model TEXT NOT NULL,
    provider TEXT NOT NULL,
    prompt_tokens INTEGER NOT NULL,
    completion_tokens INTEGER NOT NULL,
    total_tokens INTEGER NOT NULL
  )`);
  return db;
}

describe('agentMigration', () => {
  describe('migrateToMultiAgent', () => {
    it('creates a Default agent in localStorage', async () => {
      const db = await createTestDb();

      migrateToMultiAgent(db, 'You are a helpful assistant');

      const agents = JSON.parse(storage[AGENTS_KEY]);
      expect(agents).toHaveLength(1);
      expect(agents[0].name).toBe('Default');
      expect(agents[0].systemPrompt).toBe('You are a helpful assistant');
    });

    it('sets the active agent ID', async () => {
      const db = await createTestDb();

      migrateToMultiAgent(db, 'Test prompt');

      const activeId = storage[ACTIVE_AGENT_KEY];
      const agents = JSON.parse(storage[AGENTS_KEY]);
      expect(activeId).toBe(agents[0].id);
    });

    it('adds agent_id column to agent_memory table', async () => {
      const db = await createTestDb();

      migrateToMultiAgent(db, 'Test prompt');

      // Verify column exists by inserting a row with agent_id
      db.run(
        "INSERT INTO agent_memory (id, category, content, created_at, agent_id) VALUES ('test1', 'fact', 'hello', 1000, 'agent-1')"
      );
      const result = db.exec("SELECT agent_id FROM agent_memory WHERE id = 'test1'");
      expect(result[0].values[0][0]).toBe('agent-1');
    });

    it('adds agent_id column to token_usage table', async () => {
      const db = await createTestDb();

      migrateToMultiAgent(db, 'Test prompt');

      // Verify column exists by inserting a row with agent_id
      db.run(
        "INSERT INTO token_usage (id, timestamp, model, provider, prompt_tokens, completion_tokens, total_tokens, agent_id) VALUES ('t1', 1000, 'gpt-4', 'openai', 100, 50, 150, 'agent-1')"
      );
      const result = db.exec("SELECT agent_id FROM token_usage WHERE id = 't1'");
      expect(result[0].values[0][0]).toBe('agent-1');
    });

    it('is idempotent — running twice does not create duplicate agents', async () => {
      const db = await createTestDb();

      migrateToMultiAgent(db, 'Test prompt');
      migrateToMultiAgent(db, 'Test prompt');

      const agents = JSON.parse(storage[AGENTS_KEY]);
      expect(agents).toHaveLength(1);
    });

    it('existing rows get agent_id = default after migration', async () => {
      const db = await createTestDb();

      // Insert rows before migration
      db.run(
        "INSERT INTO agent_memory (id, category, content, created_at) VALUES ('pre1', 'fact', 'existing memory', 500)"
      );
      db.run(
        "INSERT INTO token_usage (id, timestamp, model, provider, prompt_tokens, completion_tokens, total_tokens) VALUES ('pre2', 500, 'gpt-4', 'openai', 10, 5, 15)"
      );

      migrateToMultiAgent(db, 'Test prompt');

      // Verify existing rows have default agent_id
      const memResult = db.exec("SELECT agent_id FROM agent_memory WHERE id = 'pre1'");
      expect(memResult[0].values[0][0]).toBe('default');

      const tokenResult = db.exec("SELECT agent_id FROM token_usage WHERE id = 'pre2'");
      expect(tokenResult[0].values[0][0]).toBe('default');
    });
  });

  describe('ensureAgentIdColumns', () => {
    it('does not throw if called multiple times', async () => {
      const db = await createTestDb();

      expect(() => ensureAgentIdColumns(db)).not.toThrow();
      expect(() => ensureAgentIdColumns(db)).not.toThrow();
    });

    it('creates indexes on agent_id columns', async () => {
      const db = await createTestDb();

      ensureAgentIdColumns(db);

      // Verify indexes exist
      const indexes = db.exec(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%agent_id'"
      );
      const indexNames = indexes[0].values.map(row => row[0]);
      expect(indexNames).toContain('idx_agent_memory_agent_id');
      expect(indexNames).toContain('idx_token_usage_agent_id');
    });
  });
});
