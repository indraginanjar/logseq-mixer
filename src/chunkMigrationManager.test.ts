import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { ChunkMigrationManager } from './chunkMigrationManager';

function createMockStore(chunkingVersion: string | null = null) {
  return {
    db: { run: vi.fn(), exec: vi.fn(() => []) },
    getChunkingVersion: vi.fn(() => chunkingVersion),
    setChunkingVersion: vi.fn(),
  };
}

describe('ChunkMigrationManager', () => {
  let store: ReturnType<typeof createMockStore>;
  let manager: ChunkMigrationManager;

  beforeEach(() => {
    store = createMockStore(null);
    manager = new ChunkMigrationManager(store as any);
  });

  afterEach(() => {
    manager.cancel();
  });

  it('needsMigration returns true when version is null', () => {
    expect(manager.needsMigration()).toBe(true);
  });

  it('needsMigration returns true when version is "1"', () => {
    store = createMockStore('1');
    manager = new ChunkMigrationManager(store as any);
    expect(manager.needsMigration()).toBe(true);
  });

  it('needsMigration returns false when version is "2"', () => {
    store = createMockStore('2');
    manager = new ChunkMigrationManager(store as any);
    expect(manager.needsMigration()).toBe(false);
  });

  it('ensureSchemaColumns calls ALTER TABLE for both columns', () => {
    manager.ensureSchemaColumns();
    const calls = store.db.run.mock.calls.map((c: any) => c[0]);
    expect(calls.some((sql: string) => /ALTER TABLE/i.test(sql) && /root_depth/i.test(sql))).toBe(true);
    expect(calls.some((sql: string) => /ALTER TABLE/i.test(sql) && /has_heading/i.test(sql))).toBe(true);
  });

  it('ensureSchemaColumns ignores errors when columns already exist', () => {
    store.db.run.mockImplementation(() => { throw new Error('duplicate column'); });
    expect(() => manager.ensureSchemaColumns()).not.toThrow();
  });

  it('scheduleBackgroundReindex sets status to in-progress', () => {
    manager.setReindexCallback(async () => {});
    manager.scheduleBackgroundReindex('key', 'model');
    expect(manager.getState().status).toBe('in-progress');
  });

  it('cancel stops in-progress migration and sets status to pending', () => {
    manager.setReindexCallback(async () => {});
    manager.scheduleBackgroundReindex('key', 'model');
    manager.cancel();
    expect(manager.getState().status).toBe('pending');
  });

  it('getState returns current migration state', () => {
    const state = manager.getState();
    expect(state).toHaveProperty('status');
    expect(state).toHaveProperty('lastMigratedPageId');
    expect(state).toHaveProperty('totalPages');
    expect(state).toHaveProperty('migratedPages');
  });

  it('resumeIfNeeded sets status to completed when no migration needed', () => {
    store = createMockStore('2');
    manager = new ChunkMigrationManager(store as any);
    manager.resumeIfNeeded();
    expect(manager.getState().status).toBe('completed');
  });
});
