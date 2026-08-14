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
        total_tokens INTEGER NOT NULL
      )
    `);
    this.db.run(
      'CREATE INDEX IF NOT EXISTS idx_token_usage_timestamp ON token_usage(timestamp)'
    );
  }

  logUsage(model: string, provider: string, promptTokens: number, completionTokens: number): string {
    const id = crypto.randomUUID();
    const totalTokens = promptTokens + completionTokens;
    this.db.run(
      'INSERT INTO token_usage (id, timestamp, model, provider, prompt_tokens, completion_tokens, total_tokens) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, Date.now(), model, provider, promptTokens, completionTokens, totalTokens]
    );
    return id;
  }

  getDaily(date?: Date): TokenUsageAggregate[] {
    let sql = 'SELECT timestamp, prompt_tokens, completion_tokens, total_tokens FROM token_usage';
    const params: any[] = [];

    if (date) {
      const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
      const endOfDay = startOfDay + 86400000;
      sql += ' WHERE timestamp >= ? AND timestamp < ?';
      params.push(startOfDay, endOfDay);
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

  getWeekly(weeksBack: number = 12): TokenUsageAggregate[] {
    const cutoff = Date.now() - weeksBack * 7 * 86400000;
    const stmt = this.db.prepare(
      'SELECT timestamp, prompt_tokens, completion_tokens, total_tokens FROM token_usage WHERE timestamp >= ? ORDER BY timestamp DESC'
    );
    stmt.bind([cutoff]);

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

  getMonthly(monthsBack: number = 12): TokenUsageAggregate[] {
    const now = new Date();
    const cutoffDate = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
    const cutoff = cutoffDate.getTime();

    const stmt = this.db.prepare(
      'SELECT timestamp, prompt_tokens, completion_tokens, total_tokens FROM token_usage WHERE timestamp >= ? ORDER BY timestamp DESC'
    );
    stmt.bind([cutoff]);

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

  getYearly(): TokenUsageAggregate[] {
    const stmt = this.db.prepare(
      'SELECT timestamp, prompt_tokens, completion_tokens, total_tokens FROM token_usage ORDER BY timestamp DESC'
    );

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

  getAllTime(): TokenUsageAggregate {
    const result = this.db.exec(
      'SELECT COALESCE(SUM(prompt_tokens), 0), COALESCE(SUM(completion_tokens), 0), COALESCE(SUM(total_tokens), 0), COUNT(*) FROM token_usage'
    );

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

  getRecentEntries(limit: number = 50): TokenUsageEntry[] {
    const stmt = this.db.prepare(
      'SELECT id, timestamp, model, provider, prompt_tokens, completion_tokens, total_tokens FROM token_usage ORDER BY timestamp DESC LIMIT ?'
    );
    stmt.bind([limit]);

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

  getTotalCount(): number {
    const result = this.db.exec('SELECT COUNT(*) FROM token_usage');
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
