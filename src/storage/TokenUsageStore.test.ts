import { describe, it, expect, beforeEach, vi } from 'vitest';
import initSqlJs from 'sql.js';
import { TokenUsageStore } from './TokenUsageStore';

describe('TokenUsageStore', () => {
  let store: TokenUsageStore;

  beforeEach(async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    store = new TokenUsageStore(db);
  });

  describe('logUsage', () => {
    it('logs a usage entry and returns an id', () => {
      const id = store.logUsage('gpt-4o', 'openai', 100, 50);
      expect(id).toBeTruthy();
      expect(id.length).toBeGreaterThan(0);
    });

    it('stores correct token values', () => {
      store.logUsage('gpt-4o', 'openai', 200, 100);
      const entries = store.getRecentEntries(1);
      expect(entries).toHaveLength(1);
      expect(entries[0].model).toBe('gpt-4o');
      expect(entries[0].provider).toBe('openai');
      expect(entries[0].promptTokens).toBe(200);
      expect(entries[0].completionTokens).toBe(100);
      expect(entries[0].totalTokens).toBe(300);
    });

    it('calculates totalTokens as sum of prompt and completion', () => {
      store.logUsage('llama3', 'ollama', 500, 250);
      const entries = store.getRecentEntries(1);
      expect(entries[0].totalTokens).toBe(750);
    });
  });

  describe('getTotalCount', () => {
    it('returns 0 when empty', () => {
      expect(store.getTotalCount()).toBe(0);
    });

    it('returns correct count after insertions', () => {
      store.logUsage('gpt-4o', 'openai', 100, 50);
      store.logUsage('gpt-4o', 'openai', 200, 100);
      store.logUsage('llama3', 'ollama', 300, 150);
      expect(store.getTotalCount()).toBe(3);
    });
  });

  describe('getAllTime', () => {
    it('returns zeros when no data', () => {
      const result = store.getAllTime();
      expect(result.periodLabel).toBe('all');
      expect(result.promptTokens).toBe(0);
      expect(result.completionTokens).toBe(0);
      expect(result.totalTokens).toBe(0);
      expect(result.callCount).toBe(0);
    });

    it('aggregates all usage', () => {
      store.logUsage('gpt-4o', 'openai', 100, 50);
      store.logUsage('gpt-4o', 'openai', 200, 100);
      store.logUsage('llama3', 'ollama', 300, 150);

      const result = store.getAllTime();
      expect(result.promptTokens).toBe(600);
      expect(result.completionTokens).toBe(300);
      expect(result.totalTokens).toBe(900);
      expect(result.callCount).toBe(3);
    });
  });

  describe('getDaily', () => {
    it('returns empty array when no data', () => {
      expect(store.getDaily()).toHaveLength(0);
    });

    it('groups entries by day', () => {
      // Insert entries with controlled timestamps
      const db = (store as any).db;
      const today = new Date();
      today.setHours(10, 0, 0, 0);
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      db.run(
        'INSERT INTO token_usage VALUES (?, ?, ?, ?, ?, ?, ?)',
        ['id1', today.getTime(), 'gpt-4o', 'openai', 100, 50, 150]
      );
      db.run(
        'INSERT INTO token_usage VALUES (?, ?, ?, ?, ?, ?, ?)',
        ['id2', today.getTime() + 1000, 'gpt-4o', 'openai', 200, 80, 280]
      );
      db.run(
        'INSERT INTO token_usage VALUES (?, ?, ?, ?, ?, ?, ?)',
        ['id3', yesterday.getTime(), 'gpt-4o', 'openai', 50, 25, 75]
      );

      const results = store.getDaily();
      expect(results).toHaveLength(2);

      // Should be ordered by timestamp (yesterday first, then today)
      const yesterdayLabel = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
      const todayLabel = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

      const yesterdayAgg = results.find(r => r.periodLabel === yesterdayLabel);
      const todayAgg = results.find(r => r.periodLabel === todayLabel);

      expect(yesterdayAgg).toBeDefined();
      expect(yesterdayAgg!.promptTokens).toBe(50);
      expect(yesterdayAgg!.callCount).toBe(1);

      expect(todayAgg).toBeDefined();
      expect(todayAgg!.promptTokens).toBe(300);
      expect(todayAgg!.completionTokens).toBe(130);
      expect(todayAgg!.callCount).toBe(2);
    });

    it('filters by specific date', () => {
      const db = (store as any).db;
      const today = new Date();
      today.setHours(12, 0, 0, 0);
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      db.run(
        'INSERT INTO token_usage VALUES (?, ?, ?, ?, ?, ?, ?)',
        ['id1', today.getTime(), 'gpt-4o', 'openai', 100, 50, 150]
      );
      db.run(
        'INSERT INTO token_usage VALUES (?, ?, ?, ?, ?, ?, ?)',
        ['id2', yesterday.getTime(), 'gpt-4o', 'openai', 200, 100, 300]
      );

      const results = store.getDaily(today);
      expect(results).toHaveLength(1);
      expect(results[0].promptTokens).toBe(100);
    });
  });

  describe('getWeekly', () => {
    it('returns empty array when no data', () => {
      expect(store.getWeekly()).toHaveLength(0);
    });

    it('groups entries by ISO week', () => {
      const db = (store as any).db;
      const now = Date.now();
      const oneWeekAgo = now - 7 * 86400000;

      db.run(
        'INSERT INTO token_usage VALUES (?, ?, ?, ?, ?, ?, ?)',
        ['id1', now, 'gpt-4o', 'openai', 100, 50, 150]
      );
      db.run(
        'INSERT INTO token_usage VALUES (?, ?, ?, ?, ?, ?, ?)',
        ['id2', now - 1000, 'gpt-4o', 'openai', 200, 80, 280]
      );
      db.run(
        'INSERT INTO token_usage VALUES (?, ?, ?, ?, ?, ?, ?)',
        ['id3', oneWeekAgo, 'gpt-4o', 'openai', 50, 25, 75]
      );

      const results = store.getWeekly(4);
      expect(results.length).toBeGreaterThanOrEqual(1);

      // Total across all weeks should match
      const totalPrompt = results.reduce((sum, r) => sum + r.promptTokens, 0);
      expect(totalPrompt).toBe(350);
    });

    it('respects weeksBack parameter', () => {
      const db = (store as any).db;
      const now = Date.now();
      const longAgo = now - 20 * 7 * 86400000; // 20 weeks ago

      db.run(
        'INSERT INTO token_usage VALUES (?, ?, ?, ?, ?, ?, ?)',
        ['id1', now, 'gpt-4o', 'openai', 100, 50, 150]
      );
      db.run(
        'INSERT INTO token_usage VALUES (?, ?, ?, ?, ?, ?, ?)',
        ['id2', longAgo, 'gpt-4o', 'openai', 200, 100, 300]
      );

      const results4 = store.getWeekly(4);
      const totalPrompt4 = results4.reduce((sum, r) => sum + r.promptTokens, 0);
      expect(totalPrompt4).toBe(100); // Only recent one

      const results52 = store.getWeekly(52);
      const totalPrompt52 = results52.reduce((sum, r) => sum + r.promptTokens, 0);
      expect(totalPrompt52).toBe(300); // Both
    });
  });

  describe('getMonthly', () => {
    it('returns empty array when no data', () => {
      expect(store.getMonthly()).toHaveLength(0);
    });

    it('groups entries by month', () => {
      const db = (store as any).db;
      const now = new Date();
      const thisMonth = new Date(now.getFullYear(), now.getMonth(), 15).getTime();
      const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15).getTime();

      db.run(
        'INSERT INTO token_usage VALUES (?, ?, ?, ?, ?, ?, ?)',
        ['id1', thisMonth, 'gpt-4o', 'openai', 100, 50, 150]
      );
      db.run(
        'INSERT INTO token_usage VALUES (?, ?, ?, ?, ?, ?, ?)',
        ['id2', thisMonth + 86400000, 'gpt-4o', 'openai', 200, 80, 280]
      );
      db.run(
        'INSERT INTO token_usage VALUES (?, ?, ?, ?, ?, ?, ?)',
        ['id3', lastMonth, 'gpt-4o', 'openai', 50, 25, 75]
      );

      const results = store.getMonthly(3);
      expect(results).toHaveLength(2);

      const thisMonthLabel = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const thisMonthAgg = results.find(r => r.periodLabel === thisMonthLabel);
      expect(thisMonthAgg).toBeDefined();
      expect(thisMonthAgg!.promptTokens).toBe(300);
      expect(thisMonthAgg!.callCount).toBe(2);
    });
  });

  describe('getYearly', () => {
    it('returns empty array when no data', () => {
      expect(store.getYearly()).toHaveLength(0);
    });

    it('groups entries by year', () => {
      const db = (store as any).db;
      const thisYear = new Date(2026, 5, 15).getTime();
      const lastYear = new Date(2025, 5, 15).getTime();

      db.run(
        'INSERT INTO token_usage VALUES (?, ?, ?, ?, ?, ?, ?)',
        ['id1', thisYear, 'gpt-4o', 'openai', 100, 50, 150]
      );
      db.run(
        'INSERT INTO token_usage VALUES (?, ?, ?, ?, ?, ?, ?)',
        ['id2', lastYear, 'gpt-4o', 'openai', 200, 100, 300]
      );

      const results = store.getYearly();
      expect(results).toHaveLength(2);

      const year2026 = results.find(r => r.periodLabel === '2026');
      const year2025 = results.find(r => r.periodLabel === '2025');

      expect(year2026).toBeDefined();
      expect(year2026!.promptTokens).toBe(100);
      expect(year2025).toBeDefined();
      expect(year2025!.promptTokens).toBe(200);
    });
  });

  describe('getRecentEntries', () => {
    it('returns empty array when no data', () => {
      expect(store.getRecentEntries()).toHaveLength(0);
    });

    it('returns entries in descending timestamp order', () => {
      const db = (store as any).db;
      db.run(
        'INSERT INTO token_usage VALUES (?, ?, ?, ?, ?, ?, ?)',
        ['id1', 1000, 'gpt-4o', 'openai', 100, 50, 150]
      );
      db.run(
        'INSERT INTO token_usage VALUES (?, ?, ?, ?, ?, ?, ?)',
        ['id2', 2000, 'gpt-4o', 'openai', 200, 100, 300]
      );
      db.run(
        'INSERT INTO token_usage VALUES (?, ?, ?, ?, ?, ?, ?)',
        ['id3', 3000, 'llama3', 'ollama', 300, 150, 450]
      );

      const entries = store.getRecentEntries(2);
      expect(entries).toHaveLength(2);
      expect(entries[0].timestamp).toBe(3000);
      expect(entries[1].timestamp).toBe(2000);
    });

    it('respects limit parameter', () => {
      store.logUsage('gpt-4o', 'openai', 100, 50);
      store.logUsage('gpt-4o', 'openai', 200, 100);
      store.logUsage('gpt-4o', 'openai', 300, 150);

      const entries = store.getRecentEntries(2);
      expect(entries).toHaveLength(2);
    });
  });

  describe('deleteAll', () => {
    it('removes all entries', () => {
      store.logUsage('gpt-4o', 'openai', 100, 50);
      store.logUsage('gpt-4o', 'openai', 200, 100);
      expect(store.getTotalCount()).toBe(2);

      store.deleteAll();
      expect(store.getTotalCount()).toBe(0);
      expect(store.getRecentEntries()).toHaveLength(0);
      expect(store.getAllTime().callCount).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('handles zero tokens', () => {
      store.logUsage('gpt-4o', 'openai', 0, 0);
      const entries = store.getRecentEntries(1);
      expect(entries[0].promptTokens).toBe(0);
      expect(entries[0].completionTokens).toBe(0);
      expect(entries[0].totalTokens).toBe(0);
    });

    it('handles large token counts', () => {
      store.logUsage('gpt-4o', 'openai', 128000, 4096);
      const entries = store.getRecentEntries(1);
      expect(entries[0].promptTokens).toBe(128000);
      expect(entries[0].completionTokens).toBe(4096);
      expect(entries[0].totalTokens).toBe(132096);
    });

    it('handles multiple models and providers', () => {
      store.logUsage('gpt-4o', 'openai', 100, 50);
      store.logUsage('llama3', 'ollama', 200, 100);
      store.logUsage('claude-3', 'litellm', 300, 150);

      const allTime = store.getAllTime();
      expect(allTime.callCount).toBe(3);
      expect(allTime.promptTokens).toBe(600);
      expect(allTime.completionTokens).toBe(300);
    });
  });
});
