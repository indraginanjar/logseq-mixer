import type { Database } from 'sql.js';

export interface MemoryEntry {
  id: string;
  category: string;
  content: string;
  createdAt: number;
  lastAccessed: number | null;
  source: string | null;
  metadata: string | null;
}

export class MemoryStore {
  private db: Database;
  private agentId: string;

  constructor(db: Database, agentId: string = 'default') {
    this.db = db;
    this.agentId = agentId;
  }

  getAgentId(): string {
    return this.agentId;
  }

  addMemory(category: string, content: string, source?: string, metadata?: string): string {
    const id = crypto.randomUUID();
    this.db.run(
      'INSERT INTO agent_memory (id, category, content, created_at, last_accessed, source, metadata, agent_id) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)',
      [id, category, content, Date.now(), source ?? null, metadata ?? null, this.agentId]
    );
    return id;
  }

  addMemoryIfUnique(category: string, content: string, source?: string, metadata?: string): string | null {
    const existing = this.searchMemories(content.slice(0, 30));
    const isDuplicate = existing.some(m => {
      if (m.category !== category) return false;
      const newWords = new Set(content.toLowerCase().split(/\s+/));
      const existWords = m.content.toLowerCase().split(/\s+/);
      const overlap = existWords.filter(w => newWords.has(w)).length;
      return overlap / Math.max(newWords.size, existWords.length) > 0.7;
    });
    if (isDuplicate) return null;
    return this.addMemory(category, content, source, metadata);
  }

  getMemories(filter?: { category?: string }): MemoryEntry[] {
    let sql = 'SELECT id, category, content, created_at, last_accessed, source, metadata FROM agent_memory WHERE agent_id = ?';
    const params: any[] = [this.agentId];
    if (filter?.category) {
      sql += ' AND category = ?';
      params.push(filter.category);
    }
    sql += ' ORDER BY created_at DESC';
    const stmt = this.db.prepare(sql);
    if (params.length) stmt.bind(params);
    const results: MemoryEntry[] = [];
    while (stmt.step()) {
      results.push(this.rowToEntry(stmt.get()));
    }
    stmt.free();
    return results;
  }

  searchMemories(query: string): MemoryEntry[] {
    const stmt = this.db.prepare('SELECT id, category, content, created_at, last_accessed, source, metadata FROM agent_memory WHERE agent_id = ? AND content LIKE ? ORDER BY created_at DESC');
    stmt.bind([this.agentId, `%${query}%`]);
    const results: MemoryEntry[] = [];
    while (stmt.step()) {
      results.push(this.rowToEntry(stmt.get()));
    }
    stmt.free();
    return results;
  }

  updateMemory(id: string, content: string): void {
    this.db.run('UPDATE agent_memory SET content = ? WHERE id = ? AND agent_id = ?', [content, id, this.agentId]);
  }

  deleteMemory(id: string): void {
    this.db.run('DELETE FROM agent_memory WHERE id = ? AND agent_id = ?', [id, this.agentId]);
  }

  deleteAll(): void {
    this.db.run('DELETE FROM agent_memory WHERE agent_id = ?', [this.agentId]);
  }

  getRecentMemories(limit: number): MemoryEntry[] {
    const stmt = this.db.prepare('SELECT id, category, content, created_at, last_accessed, source, metadata FROM agent_memory WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?');
    stmt.bind([this.agentId, limit]);
    const results: MemoryEntry[] = [];
    while (stmt.step()) {
      results.push(this.rowToEntry(stmt.get()));
    }
    stmt.free();
    return results;
  }

  getMemoryCount(): number {
    const result = this.db.exec('SELECT COUNT(*) as cnt FROM agent_memory WHERE agent_id = ?', [this.agentId]);
    return result.length > 0 ? (result[0].values[0][0] as number) : 0;
  }

  updateLastAccessed(ids: string[]): void {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(',');
    this.db.run(
      `UPDATE agent_memory SET last_accessed = ? WHERE id IN (${placeholders}) AND agent_id = ?`,
      [Date.now(), ...ids, this.agentId]
    );
  }

  private rowToEntry(row: any[]): MemoryEntry {
    return {
      id: row[0] as string,
      category: row[1] as string,
      content: row[2] as string,
      createdAt: row[3] as number,
      lastAccessed: (row[4] as number | null) ?? null,
      source: (row[5] as string | null) ?? null,
      metadata: (row[6] as string | null) ?? null,
    };
  }
}
