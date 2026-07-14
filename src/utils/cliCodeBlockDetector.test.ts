import { describe, it, expect } from 'vitest';
import { wrapCliInCodeBlocks } from './cliCodeBlockDetector';

describe('wrapCliInCodeBlocks', () => {
  describe('detects shell prompt prefixes', () => {
    it('wraps $ prompt commands', () => {
      const input = 'Run this:\n$ npm install\nThen start it.';
      const output = wrapCliInCodeBlocks(input);
      expect(output).toContain('```\n$ npm install\n```');
    });

    it('wraps > prompt commands', () => {
      const input = '> dir /s';
      const output = wrapCliInCodeBlocks(input);
      expect(output).toBe('```\n> dir /s\n```');
    });

    it('wraps PowerShell prompts', () => {
      const input = 'PS C:\\Users\\dev> Get-Process';
      const output = wrapCliInCodeBlocks(input);
      expect(output).toBe('```\nPS C:\\Users\\dev> Get-Process\n```');
    });

    it('wraps Windows cmd prompts', () => {
      const input = 'C:\\Projects> npm run build';
      const output = wrapCliInCodeBlocks(input);
      expect(output).toBe('```\nC:\\Projects> npm run build\n```');
    });

    it('wraps SSH-style prompts', () => {
      const input = 'user@server:~$ sudo apt update';
      const output = wrapCliInCodeBlocks(input);
      expect(output).toBe('```\nuser@server:~$ sudo apt update\n```');
    });
  });

  describe('detects known CLI commands', () => {
    it('wraps git commands', () => {
      const input = 'First commit your changes:\ngit add .\ngit commit -m "fix"';
      const output = wrapCliInCodeBlocks(input);
      expect(output).toContain('```\ngit add .\ngit commit -m "fix"\n```');
    });

    it('wraps npm/pnpm commands', () => {
      const input = 'npm install express';
      const output = wrapCliInCodeBlocks(input);
      expect(output).toBe('```\nnpm install express\n```');
    });

    it('wraps docker commands', () => {
      const input = 'docker run -d -p 3000:3000 myapp';
      const output = wrapCliInCodeBlocks(input);
      expect(output).toBe('```\ndocker run -d -p 3000:3000 myapp\n```');
    });

    it('wraps curl commands', () => {
      const input = 'curl -X POST http://localhost:3000/api';
      const output = wrapCliInCodeBlocks(input);
      expect(output).toBe('```\ncurl -X POST http://localhost:3000/api\n```');
    });

    it('wraps python commands', () => {
      const input = 'python3 -m venv .venv';
      const output = wrapCliInCodeBlocks(input);
      expect(output).toBe('```\npython3 -m venv .venv\n```');
    });

    it('wraps sudo commands', () => {
      const input = 'sudo systemctl restart nginx';
      const output = wrapCliInCodeBlocks(input);
      expect(output).toBe('```\nsudo systemctl restart nginx\n```');
    });

    it('wraps ./script.sh style commands', () => {
      const input = './deploy.sh --production';
      const output = wrapCliInCodeBlocks(input);
      expect(output).toBe('```\n./deploy.sh --production\n```');
    });
  });

  describe('detects CLI output patterns', () => {
    it('wraps error/warning log output', () => {
      const input = 'The build failed:\nerror: Module not found\nwarning: deprecated API';
      const output = wrapCliInCodeBlocks(input);
      expect(output).toContain('```\nerror: Module not found\nwarning: deprecated API\n```');
    });

    it('wraps stack traces', () => {
      const input = 'Something crashed:\n    at Object.run (index.js:42:10)\n    at main (app.js:5:3)';
      const output = wrapCliInCodeBlocks(input);
      expect(output).toContain('```');
      expect(output).toContain('at Object.run (index.js:42:10)');
    });

    it('wraps test runner output', () => {
      const input = 'Results:\n  3 passing\n  1 failing';
      const output = wrapCliInCodeBlocks(input);
      expect(output).toContain('```');
      expect(output).toContain('3 passing');
      expect(output).toContain('1 failing');
    });

    it('wraps test result symbols', () => {
      const input = '✓ should work\n✗ should not fail';
      const output = wrapCliInCodeBlocks(input);
      expect(output).toContain('```\n✓ should work\n✗ should not fail\n```');
    });
  });

  describe('groups consecutive CLI lines', () => {
    it('groups multiple commands into one code block', () => {
      const input = 'Setup:\nnpm install\nnpm run build\nnpm test\nDone!';
      const output = wrapCliInCodeBlocks(input);
      expect(output).toBe('Setup:\n```\nnpm install\nnpm run build\nnpm test\n```\nDone!');
    });

    it('creates separate blocks for non-consecutive CLI lines', () => {
      const input = 'First:\ngit add .\nThen:\ngit commit -m "done"';
      const output = wrapCliInCodeBlocks(input);
      expect(output).toContain('```\ngit add .\n```');
      expect(output).toContain('```\ngit commit -m "done"\n```');
    });
  });

  describe('preserves existing code fences', () => {
    it('does not double-wrap content already in code fences', () => {
      const input = '```\nnpm install\n```';
      const output = wrapCliInCodeBlocks(input);
      expect(output).toBe('```\nnpm install\n```');
    });

    it('does not touch content inside fenced blocks', () => {
      const input = '```bash\ngit status\ngit log\n```';
      const output = wrapCliInCodeBlocks(input);
      expect(output).toBe('```bash\ngit status\ngit log\n```');
    });

    it('handles mixed fenced and unfenced content', () => {
      const input = '```\nnpm install\n```\nThen run:\nnpm start';
      const output = wrapCliInCodeBlocks(input);
      // First block untouched, second gets wrapped
      expect(output).toBe('```\nnpm install\n```\nThen run:\n```\nnpm start\n```');
    });

    it('handles tilde fences', () => {
      const input = '~~~\ngit status\n~~~';
      const output = wrapCliInCodeBlocks(input);
      expect(output).toBe('~~~\ngit status\n~~~');
    });
  });

  describe('does not wrap normal prose', () => {
    it('leaves plain text alone', () => {
      const input = 'This is a regular message about something.';
      const output = wrapCliInCodeBlocks(input);
      expect(output).toBe(input);
    });

    it('leaves markdown formatting alone', () => {
      const input = '**Bold text** and *italic* with [links](http://example.com)';
      const output = wrapCliInCodeBlocks(input);
      expect(output).toBe(input);
    });

    it('does not wrap empty lines', () => {
      const input = 'Hello\n\nWorld';
      const output = wrapCliInCodeBlocks(input);
      expect(output).toBe(input);
    });

    it('leaves bullet lists alone', () => {
      const input = '- Item one\n- Item two\n- Item three';
      const output = wrapCliInCodeBlocks(input);
      expect(output).toBe(input);
    });
  });

  describe('edge cases', () => {
    it('handles empty string', () => {
      expect(wrapCliInCodeBlocks('')).toBe('');
    });

    it('handles single newline', () => {
      expect(wrapCliInCodeBlocks('\n')).toBe('\n');
    });

    it('handles command at end of text without trailing newline', () => {
      const input = 'Run this:\nnpm start';
      const output = wrapCliInCodeBlocks(input);
      expect(output).toBe('Run this:\n```\nnpm start\n```');
    });

    it('handles multiple code fence sections correctly', () => {
      const input = '```js\nconst x = 1;\n```\n\nNow run:\nnpm test\n\n```\nalready fenced\n```';
      const output = wrapCliInCodeBlocks(input);
      expect(output).toContain('```\nnpm test\n```');
      // The js code block should be untouched
      expect(output).toContain('```js\nconst x = 1;\n```');
    });
  });
});
