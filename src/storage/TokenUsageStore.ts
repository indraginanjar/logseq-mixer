import type { Database } from 'sql.js';

export interface TokenUsageEntry {
  id: string;
  timestamp: number;
  model: string;
  provider: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface TokenUsageAggregate {
  periodLabel: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  callCount: number;
}

export class TokenUsageStore {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
    this.db.run(`
      CREATE TABLE IF NOT EXISTS token_usage (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        model TEXT NOT NULL,
        provider TEXT NOT NULL,
        prompt_tokens INTEGER NOT NULL,
        completion_tokens INTEGER NOT NULL,
        total_tokens INTEGER NOT NULL,
        agent_id TEXT DEFAULT 'default'
      )
    `);
    this.db.run(
      'CREATE INDEX IF NOT EXISTS idx_token_usage_timestamp ON token_usage(timestamp)'
    );
  }

  logUsage(model: string, provider: string, promptTokens: number, completionTokens: number, agentId: string = 'default'): string {
    const id = crypto.randomUUID();
    const totalTokens = promptTokens + completionTokens;
    this.db.run(
      'INSERT INTO token_usage (id, timestamp, model, provider, prompt_tokens, completion_tokens, total_tokens, agent_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [id, Date.now(), model, provider, promptTokens, completionTokens, totalTokens, agentId]
    );
    return id;
  }

  getDaily(date?: Date, agentId?: string): TokenUsageAggregate[] {
    let sql = 'SELECT timestamp, prompt_tokens, completion_tokens, total_tokens FROM token_usage';
    const params: any[] = [];
    const conditions: string[] = [];

    if (date) {
      const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
      const endOfDay = startOfDay + 86400000;
      conditions.push('timestamp >= ? AND timestamp < ?');
      params.push(startOfDay, endOfDay);
    }

    if (agentId) {
      conditions.push('agent_id = ?');
      params.push(agentId);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY timestamp DESC';

    const stmt = this.db.prepare(sql);
    if (params.length) stmt.bind(params);

    const groups = new Map<string, TokenUsageAggregate>();

    while (stmt.step()) {
      const row = stmt.get();
      const ts = row[0] as number;
      const label = this.timestampToDateLabel(ts);

      const agg = groups.get(label) ?? { periodLabel: label, promptTokens: 0, completionTokens: 0, totalTokens: 0, callCount: 0 };
      agg.promptTokens += row[1] as number;
      agg.completionTokens += row[2] as number;
      agg.totalTokens += row[3] as number;
      agg.callCount += 1;
      groups.set(label, agg);
    }

    stmt.free();
    return Array.from(groups.values());
  }

  getWeekly(weeksBack: number = 12, agentId?: string): TokenUsageAggregate[] {
    const cutoff = Date.now() - weeksBack * 7 * 86400000;
    let sql = 'SELECT timestamp, prompt_tokens, completion_tokens, total_tokens FROM token_usage WHERE timestamp >= ?';
    const params: any[] = [cutoff];

    if (agentId) {
      sql += ' AND agent_id = ?';
      params.push(agentId);
    }

    sql += ' ORDER BY timestamp DESC';

    const stmt = this.db.prepare(sql);
    stmt.bind(params);

    const groups = new Map<string, TokenUsageAggregate>();

    while (stmt.step()) {
      const row = stmt.get();
      const ts = row[0] as number;
      const label = this.timestampToISOWeekLabel(ts);

      const agg = groups.get(label) ?? { periodLabel: label, promptTokens: 0, completionTokens: 0, totalTokens: 0, callCount: 0 };
      agg.promptTokens += row[1] as number;
      agg.completionTokens += row[2] as number;
      agg.totalTokens += row[3] as number;
      agg.callCount += 1;
      groups.set(label, agg);
    }

    stmt.free();
    return Array.from(groups.values());
  }

  getMonthly(monthsBack: number = 12, agentId?: string): TokenUsageAggregate[] {
    const now = new Date();
    const cutoffDate = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
    const cutoff = cutoffDate.getTime();

    let sql = 'SELECT timestamp, prompt_tokens, completion_tokens, total_tokens FROM token_usage WHERE timestamp >= ?';
    const params: any[] = [cutoff];

    if (agentId) {
      sql += ' AND agent_id = ?';
      params.push(agentId);
    }

    sql += ' ORDER BY timestamp DESC';

    const stmt = this.db.prepare(sql);
    stmt.bind(params);

    const groups = new Map<string, TokenUsageAggregate>();

    while (stmt.step()) {
      const row = stmt.get();
      const ts = row[0] as number;
      const d = new Date(ts);
      const label = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

      const agg = groups.get(label) ?? { periodLabel: label, promptTokens: 0, completionTokens: 0, totalTokens: 0, callCount: 0 };
      agg.promptTokens += row[1] as number;
      agg.completionTokens += row[2] as number;
      agg.totalTokens += row[3] as number;
      agg.callCount += 1;
      groups.set(label, agg);
    }

    stmt.free();
    return Array.from(groups.values());
  }

  getYearly(agentId?: string): TokenUsageAggregate[] {
    let sql = 'SELECT timestamp, prompt_tokens, completion_tokens, total_tokens FROM token_usage';
    const params: any[] = [];

    if (agentId) {
      sql += ' WHERE agent_id = ?';
      params.push(agentId);
    }

    sql += ' ORDER BY timestamp DESC';

    const stmt = this.db.prepare(sql);
    if (params.length) stmt.bind(params);

    const groups = new Map<string, TokenUsageAggregate>();

    while (stmt.step()) {
      const row = stmt.get();
      const ts = row[0] as number;
      const label = String(new Date(ts).getFullYear());

      const agg = groups.get(label) ?? { periodLabel: label, promptTokens: 0, completionTokens: 0, totalTokens: 0, callCount: 0 };
      agg.promptTokens += row[1] as number;
      agg.completionTokens += row[2] as number;
      agg.totalTokens += row[3] as number;
      agg.callCount += 1;
      groups.set(label, agg);
    }

    stmt.free();
    return Array.from(groups.values());
  }

  getAllTime(agentId?: string): TokenUsageAggregate {
    let sql = 'SELECT COALESCE(SUM(prompt_tokens), 0), COALESCE(SUM(completion_tokens), 0), COALESCE(SUM(total_tokens), 0), COUNT(*) FROM token_usage';
    const params: any[] = [];

    if (agentId) {
      sql += ' WHERE agent_id = ?';
      params.push(agentId);
    }

    const result = this.db.exec(sql, params);

    if (result.length === 0 || result[0].values.length === 0) {
      return { periodLabel: 'all', promptTokens: 0, completionTokens: 0, totalTokens: 0, callCount: 0 };
    }

    const row = result[0].values[0];
    return {
      periodLabel: 'all',
      promptTokens: row[0] as number,
      completionTokens: row[1] as number,
      totalTokens: row[2] as number,
      callCount: row[3] as number,
    };
  }

  getRecentEntries(limit: number = 50, agentId?: string): TokenUsageEntry[] {
    let sql = 'SELECT id, timestamp, model, provider, prompt_tokens, completion_tokens, total_tokens FROM token_usage';
    const params: any[] = [];

    if (agentId) {
      sql += ' WHERE agent_id = ?';
      params.push(agentId);
    }

    sql += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(limit);

    const stmt = this.db.prepare(sql);
    stmt.bind(params);

    const results: TokenUsageEntry[] = [];
    while (stmt.step()) {
      const row = stmt.get();
      results.push({
        id: row[0] as string,
        timestamp: row[1] as number,
        model: row[2] as string,
        provider: row[3] as string,
        promptTokens: row[4] as number,
        completionTokens: row[5] as number,
        totalTokens: row[6] as number,
      });
    }

    stmt.free();
    return results;
  }

  getTotalCount(agentId?: string): number {
    let sql = 'SELECT COUNT(*) FROM token_usage';
    const params: any[] = [];

    if (agentId) {
      sql += ' WHERE agent_id = ?';
      params.push(agentId);
    }

    const result = this.db.exec(sql, params);
    return result.length > 0 ? (result[0].values[0][0] as number) : 0;
  }

  deleteAll(): void {
    this.db.run('DELETE FROM token_usage');
  }

  private timestampToDateLabel(ts: number): string {
    const d = new Date(ts);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private timestampToISOWeekLabel(ts: number): string {
    const d = new Date(ts);
    const { year, week } = this.getISOWeek(d);
    return `${year}-W${String(week).padStart(2, '0')}`;
  }

  private getISOWeek(date: Date): { year: number; week: number } {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    // Set to nearest Thursday: current date + 4 - current day number (Monday=1, Sunday=7)
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    return { year: d.getUTCFullYear(), week: weekNo };
  }
}
