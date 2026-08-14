import type { Database } from 'sql.js';
import { loadAgents, createDefaultAgent, setActiveAgentId } from './AgentConfigStore';

/**
 * Migrate from single-agent to multi-agent system.
 * Idempotent — safe to call multiple times.
 *
 * Steps:
 * 1. Check if agents already exist in localStorage (skip if so)
 * 2. Create Default agent from current settings
 * 3. Add agent_id column to agent_memory table (if not exists)
 * 4. Add agent_id column to token_usage table (if not exists)
 * 5. Create indexes
 */
export function migrateToMultiAgent(db: Database, currentPrompt: string): void {
  // Step 1: Check if migration already done
  const existingAgents = loadAgents();
  if (existingAgents.length > 0) {
    // Already migrated — just ensure DB columns exist
    ensureAgentIdColumns(db);
    return;
  }

  // Step 2: Create Default agent
  const defaultAgent = createDefaultAgent(currentPrompt);
  setActiveAgentId(defaultAgent.id);

  // Step 3 & 4: Add agent_id columns
  ensureAgentIdColumns(db);
}

/**
 * Ensure agent_id columns exist on relevant tables.
 * Uses SQLite's error handling — ALTER TABLE will throw if column already exists,
 * which we catch and ignore.
 */
export function ensureAgentIdColumns(db: Database): void {
  // agent_memory table
  try {
    db.run('ALTER TABLE agent_memory ADD COLUMN agent_id TEXT DEFAULT \'default\'');
  } catch {
    // Column already exists — ignore
  }
  db.run('CREATE INDEX IF NOT EXISTS idx_agent_memory_agent_id ON agent_memory(agent_id)');

  // token_usage table
  try {
    db.run('ALTER TABLE token_usage ADD COLUMN agent_id TEXT DEFAULT \'default\'');
  } catch {
    // Column already exists — ignore
  }
  db.run('CREATE INDEX IF NOT EXISTS idx_token_usage_agent_id ON token_usage(agent_id)');
}
