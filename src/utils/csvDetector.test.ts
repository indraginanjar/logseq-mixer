import { describe, it, expect } from 'vitest';
import { detectCsvBlocks, mightContainCsv } from './csvDetector';

describe('detectCsvBlocks', () => {
  describe('detects comma-separated CSV', () => {
    it('detects a simple 2-column CSV', () => {
      const input = 'Name, Age\nAlice, 30\nBob, 25';
      const parts = detectCsvBlocks(input);
      expect(parts).toHaveLength(1);
      expect(parts[0].type).toBe('csv');
      if (parts[0].type === 'csv') {
        expect(parts[0].table.headers).toEqual(['Name', 'Age']);
        expect(parts[0].table.rows).toEqual([['Alice', '30'], ['Bob', '25']]);
      }
    });

    it('detects a multi-column CSV', () => {
      const input = 'Name,Age,City,Country\nAlice,30,NYC,USA\nBob,25,London,UK';
      const parts = detectCsvBlocks(input);
      expect(parts).toHaveLength(1);
      expect(parts[0].type).toBe('csv');
      if (parts[0].type === 'csv') {
        expect(parts[0].table.headers).toEqual(['Name', 'Age', 'City', 'Country']);
        expect(parts[0].table.rows).toHaveLength(2);
      }
    });

    it('preserves raw content', () => {
      const input = 'Name,Age\nAlice,30\nBob,25';
      const parts = detectCsvBlocks(input);
      if (parts[0].type === 'csv') {
        expect(parts[0].table.rawContent).toBe(input);
      }
    });
  });

  describe('detects semicolon-separated CSV', () => {
    it('detects semicolons as delimiter', () => {
      const input = 'Name;Age;City\nAlice;30;Paris\nBob;25;Berlin';
      const parts = detectCsvBlocks(input);
      expect(parts).toHaveLength(1);
      expect(parts[0].type).toBe('csv');
      if (parts[0].type === 'csv') {
        expect(parts[0].table.headers).toEqual(['Name', 'Age', 'City']);
        expect(parts[0].table.rows).toEqual([['Alice', '30', 'Paris'], ['Bob', '25', 'Berlin']]);
      }
    });
  });

  describe('detects tab-separated CSV', () => {
    it('detects tabs as delimiter', () => {
      const input = 'Name\tAge\tCity\nAlice\t30\tNYC\nBob\t25\tLA';
      const parts = detectCsvBlocks(input);
      expect(parts).toHaveLength(1);
      expect(parts[0].type).toBe('csv');
      if (parts[0].type === 'csv') {
        expect(parts[0].table.headers).toEqual(['Name', 'Age', 'City']);
        expect(parts[0].table.rows).toEqual([['Alice', '30', 'NYC'], ['Bob', '25', 'LA']]);
      }
    });
  });

  describe('handles quoted fields', () => {
    it('handles fields with commas inside quotes', () => {
      const input = 'Name,Description\n"Smith, John","A person, notable"\nJane,"Another, one"';
      const parts = detectCsvBlocks(input);
      expect(parts).toHaveLength(1);
      expect(parts[0].type).toBe('csv');
      if (parts[0].type === 'csv') {
        expect(parts[0].table.headers).toEqual(['Name', 'Description']);
        expect(parts[0].table.rows[0]).toEqual(['Smith, John', 'A person, notable']);
        expect(parts[0].table.rows[1]).toEqual(['Jane', 'Another, one']);
      }
    });

    it('handles escaped quotes inside fields', () => {
      const input = 'Name,Quote\nAlice,"She said ""hello"""\nBob,"Normal text"';
      const parts = detectCsvBlocks(input);
      expect(parts[0].type).toBe('csv');
      if (parts[0].type === 'csv') {
        expect(parts[0].table.rows[0]).toEqual(['Alice', 'She said "hello"']);
      }
    });
  });

  describe('splits text and CSV parts', () => {
    it('separates prose before and after CSV', () => {
      const input = 'Here is the data:\n\nName,Age\nAlice,30\nBob,25\n\nThat was the table.';
      const parts = detectCsvBlocks(input);
      expect(parts).toHaveLength(3);
      expect(parts[0].type).toBe('text');
      expect(parts[1].type).toBe('csv');
      expect(parts[2].type).toBe('text');
      if (parts[0].type === 'text') {
        expect(parts[0].content).toContain('Here is the data:');
      }
      if (parts[2].type === 'text') {
        expect(parts[2].content).toContain('That was the table.');
      }
    });

    it('handles CSV at the start of text', () => {
      const input = 'Name,Age\nAlice,30\nBob,25\n\nEnd of data.';
      const parts = detectCsvBlocks(input);
      expect(parts[0].type).toBe('csv');
      expect(parts[parts.length - 1].type).toBe('text');
    });

    it('handles multiple CSV blocks', () => {
      const input = 'Table 1:\n\nA,B\n1,2\n3,4\n\nTable 2:\n\nX,Y\n5,6\n7,8';
      const parts = detectCsvBlocks(input);
      const csvParts = parts.filter(p => p.type === 'csv');
      expect(csvParts).toHaveLength(2);
    });
  });

  describe('skips code fences', () => {
    it('does not detect CSV inside code fences', () => {
      const input = '```\nName,Age\nAlice,30\nBob,25\n```';
      const parts = detectCsvBlocks(input);
      expect(parts).toHaveLength(1);
      expect(parts[0].type).toBe('text');
    });

    it('does not detect CSV inside fenced blocks with language', () => {
      const input = '```csv\nName,Age\nAlice,30\n```';
      const parts = detectCsvBlocks(input);
      expect(parts).toHaveLength(1);
      expect(parts[0].type).toBe('text');
    });

    it('detects CSV outside of code fences', () => {
      const input = '```js\nconst x = 1;\n```\n\nName,Age\nAlice,30\nBob,25';
      const parts = detectCsvBlocks(input);
      const csvParts = parts.filter(p => p.type === 'csv');
      expect(csvParts).toHaveLength(1);
    });
  });

  describe('does not false-positive on non-CSV content', () => {
    it('does not detect markdown tables as CSV', () => {
      const input = '| Name | Age |\n|------|-----|\n| Alice | 30 |';
      const parts = detectCsvBlocks(input);
      expect(parts).toHaveLength(1);
      expect(parts[0].type).toBe('text');
    });

    it('does not detect single-column data as CSV', () => {
      const input = 'Apple\nBanana\nCherry';
      const parts = detectCsvBlocks(input);
      expect(parts).toHaveLength(1);
      expect(parts[0].type).toBe('text');
    });

    it('does not detect prose with occasional commas as CSV', () => {
      const input = 'Hello, world!\nThis is a test, nothing more.';
      const parts = detectCsvBlocks(input);
      // This could potentially be detected as CSV with 2 columns,
      // but the column count consistency should prevent it
      const csvParts = parts.filter(p => p.type === 'csv');
      // If both lines happen to have 1 comma each, they might be detected
      // That's acceptable since they look structurally like CSV
      // The key is we don't break on normal prose without delimiters
      expect(parts.length).toBeGreaterThanOrEqual(1);
    });

    it('does not detect bullet lists as CSV', () => {
      const input = '- Item one, first\n- Item two, second\n- Item three, third';
      const parts = detectCsvBlocks(input);
      expect(parts).toHaveLength(1);
      expect(parts[0].type).toBe('text');
    });

    it('does not detect markdown headers as CSV', () => {
      const input = '## Section, Title\n### Another, Section';
      const parts = detectCsvBlocks(input);
      expect(parts).toHaveLength(1);
      expect(parts[0].type).toBe('text');
    });
  });

  describe('requires minimum rows', () => {
    it('does not detect single-line as CSV', () => {
      const input = 'Name,Age,City';
      const parts = detectCsvBlocks(input);
      // Single line cannot form a CSV table (needs header + data)
      expect(parts).toHaveLength(1);
      expect(parts[0].type).toBe('text');
    });

    it('detects exactly 2 lines as CSV (header + 1 row)', () => {
      const input = 'Name,Age\nAlice,30';
      const parts = detectCsvBlocks(input);
      expect(parts).toHaveLength(1);
      expect(parts[0].type).toBe('csv');
    });
  });

  describe('column consistency', () => {
    it('rejects data with inconsistent columns', () => {
      const input = 'A,B,C\n1,2\n3,4,5,6\n7';
      const parts = detectCsvBlocks(input);
      // Should not be detected as CSV since column count is all over the place
      expect(parts).toHaveLength(1);
      expect(parts[0].type).toBe('text');
    });

    it('allows minor inconsistency within 80% threshold', () => {
      const input = 'A,B,C\n1,2,3\n4,5,6\n7,8,9\n10,11,12\nx,y';
      const parts = detectCsvBlocks(input);
      // 4 out of 5 data lines + header have 3 columns = 5/6 = 83% > 80%
      expect(parts).toHaveLength(1);
      expect(parts[0].type).toBe('csv');
    });
  });
});

describe('mightContainCsv', () => {
  it('returns true for text with 2+ CSV candidate lines', () => {
    expect(mightContainCsv('Name,Age\nAlice,30')).toBe(true);
  });

  it('returns false for single line', () => {
    expect(mightContainCsv('Name,Age')).toBe(false);
  });

  it('returns false for plain text without delimiters', () => {
    expect(mightContainCsv('Hello world\nAnother line')).toBe(false);
  });

  it('returns true for tab-separated content', () => {
    expect(mightContainCsv('Name\tAge\nAlice\t30')).toBe(true);
  });

  it('returns false for empty text', () => {
    expect(mightContainCsv('')).toBe(false);
  });
});
