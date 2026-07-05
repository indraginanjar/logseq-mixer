import { describe, it, expect, beforeEach } from 'vitest';
import initSqlJs from 'sql.js';
import { MemoryStore } from './MemoryStore';

describe('MemoryStore', () => {
  let store: MemoryStore;

  beforeEach(async () => {
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
    store = new MemoryStore(db);
  });

  it('adds a memory and returns an id', () => {
    const id = store.addMemory('fact', 'The sky is blue');
    expect(id).toBeTruthy();
    expect(id.length).toBeGreaterThan(0);
  });

  it('retrieves all memories', () => {
    store.addMemory('fact', 'Fact 1');
    store.addMemory('preference', 'Pref 1');
    const all = store.getMemories();
    expect(all).toHaveLength(2);
  });

  it('filters by category', () => {
    store.addMemory('fact', 'Fact 1');
    store.addMemory('preference', 'Pref 1');
    store.addMemory('fact', 'Fact 2');
    const facts = store.getMemories({ category: 'fact' });
    expect(facts).toHaveLength(2);
    expect(facts.every(m => m.category === 'fact')).toBe(true);
  });

  it('searches by keyword', () => {
    store.addMemory('fact', 'TypeScript is great');
    store.addMemory('fact', 'Python is also good');
    const results = store.searchMemories('TypeScript');
    expect(results).toHaveLength(1);
    expect(results[0].content).toContain('TypeScript');
  });

  it('updates a memory', () => {
    const id = store.addMemory('fact', 'Old content');
    store.updateMemory(id, 'New content');
    const memories = store.getMemories();
    expect(memories[0].content).toBe('New content');
  });

  it('deletes a memory', () => {
    const id = store.addMemory('fact', 'To delete');
    store.deleteMemory(id);
    expect(store.getMemories()).toHaveLength(0);
  });

  it('deleteAll clears everything', () => {
    store.addMemory('fact', 'One');
    store.addMemory('fact', 'Two');
    store.deleteAll();
    expect(store.getMemoryCount()).toBe(0);
  });

  it('getRecentMemories returns limited results', () => {
    store.addMemory('fact', 'First');
    store.addMemory('fact', 'Second');
    store.addMemory('fact', 'Third');
    const recent = store.getRecentMemories(2);
    expect(recent).toHaveLength(2);
  });

  it('getMemoryCount returns correct count', () => {
    store.addMemory('fact', 'A');
    store.addMemory('fact', 'B');
    expect(store.getMemoryCount()).toBe(2);
  });

  it('updateLastAccessed updates timestamps', () => {
    const id = store.addMemory('fact', 'Test');
    const before = store.getMemories()[0].lastAccessed;
    expect(before).toBeNull();
    store.updateLastAccessed([id]);
    const after = store.getMemories()[0].lastAccessed;
    expect(after).not.toBeNull();
    expect(after).toBeGreaterThan(0);
  });

  it('addMemoryIfUnique rejects duplicates', () => {
    store.addMemory('preference', 'I prefer bullet points for summaries');
    const result = store.addMemoryIfUnique('preference', 'I prefer bullet points for summaries');
    expect(result).toBeNull();
    expect(store.getMemoryCount()).toBe(1);
  });

  it('addMemoryIfUnique accepts non-duplicates', () => {
    store.addMemory('preference', 'I prefer bullet points');
    const result = store.addMemoryIfUnique('fact', 'The project uses React');
    expect(result).not.toBeNull();
    expect(store.getMemoryCount()).toBe(2);
  });
});
