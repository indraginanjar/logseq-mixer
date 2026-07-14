/**
 * Detects lines that look like CLI commands or CLI output and wraps them
 * in markdown code fences so they render as code blocks in the chat UI.
 *
 * Rules:
 * - Lines already inside a code fence (``` or ~~~) are left untouched.
 * - A "CLI command" line starts with a shell prompt pattern (e.g., `$`, `>`, `#`, `PS>`, `C:\>`)
 *   or begins with a well-known CLI executable/keyword (e.g., `git`, `npm`, `docker`, `pip`, etc.).
 * - Consecutive CLI-looking lines are grouped into a single code block.
 * - Isolated single-line commands are wrapped as inline or fenced code depending on context.
 */

/** Common shell prompt prefixes (regex patterns). */
const PROMPT_PATTERNS = [
  /^\s*\$\s+/,                    // $ command
  /^\s*>\s+/,                     // > command (Windows cmd / generic)
  /^\s*#\s+/,                     // # command (root shell)
  /^\s*PS[^>]*>\s*/i,            // PS C:\Users> command (PowerShell)
  /^\s*[A-Z]:\\[^>]*>\s*/i,     // C:\path> command (Windows cmd prompt)
  /^\s*\w+@[\w.-]+[:%~][^\$#]*[\$#]\s*/,  // user@host:~$ (SSH-style)
];

/** Well-known CLI command prefixes (first token on the line). */
const CLI_COMMANDS = new Set([
  // Version control
  'git',
  // Package managers
  'npm', 'npx', 'pnpm', 'yarn', 'bun',
  'pip', 'pip3', 'pipx', 'poetry', 'conda',
  'cargo', 'rustup',
  'go', 'gem', 'bundle',
  'brew', 'apt', 'apt-get', 'yum', 'dnf', 'pacman', 'snap',
  'choco', 'scoop', 'winget',
  // Containers & infra
  'docker', 'docker-compose', 'podman',
  'kubectl', 'helm', 'terraform', 'ansible',
  // Build tools
  'make', 'cmake', 'gradle', 'mvn', 'ant',
  // Common CLI tools
  'curl', 'wget', 'ssh', 'scp', 'rsync',
  'ls', 'dir', 'cd', 'cp', 'mv', 'rm', 'mkdir', 'rmdir', 'cat', 'echo',
  'grep', 'find', 'awk', 'sed', 'chmod', 'chown', 'tar', 'zip', 'unzip',
  'node', 'python', 'python3', 'ruby', 'java', 'javac',
  'tsc', 'eslint', 'prettier', 'vitest', 'jest', 'mocha',
  // Shell builtins
  'export', 'source', 'alias', 'sudo',
]);

/**
 * Patterns that indicate a line is likely CLI output rather than prose.
 * These catch common output formats from tools.
 */
const OUTPUT_PATTERNS = [
  /^\s*[-]+\s*$/,                              // separator line: -----
  /^\s*[├└│─┤┌┐┘┬┴┼]+/,                       // tree drawing chars
  /^\s*(error|warning|info|debug|WARN|ERR|INFO|DEBUG)[\s:[\]]/i, // log levels
  /^\s*at\s+[\w.$]+\s*\(.*:\d+:\d+\)/,        // stack traces
  /^\s*\d+\s+(passing|failing|pending)/,       // test runner output
  /^\s*✓|✗|✘|●|○|◌|PASS|FAIL/,               // test result symbols
];

function hasPromptPrefix(line: string): boolean {
  return PROMPT_PATTERNS.some(p => p.test(line));
}

function startsWithCliCommand(line: string): boolean {
  const trimmed = line.trim();
  // Extract first token
  const match = trimmed.match(/^(\S+)/);
  if (!match) return false;
  const firstToken = match[1].toLowerCase();
  // Also handle things like `./script.sh` or paths to executables
  if (firstToken.startsWith('./') || firstToken.startsWith('.\\')) return true;
  return CLI_COMMANDS.has(firstToken);
}

function looksLikeCliOutput(line: string): boolean {
  return OUTPUT_PATTERNS.some(p => p.test(line));
}

function isCliLine(line: string): boolean {
  if (line.trim() === '') return false;
  return hasPromptPrefix(line) || startsWithCliCommand(line) || looksLikeCliOutput(line);
}

/**
 * Wraps detected CLI commands/output lines in markdown code fences.
 * Lines already inside existing code fences are not modified.
 */
export function wrapCliInCodeBlocks(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];
  let inExistingFence = false;
  let cliBuffer: string[] = [];

  const flushCliBuffer = () => {
    if (cliBuffer.length > 0) {
      result.push('```');
      result.push(...cliBuffer);
      result.push('```');
      cliBuffer = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for existing code fence boundaries
    if (/^\s*(`{3,}|~{3,})/.test(line)) {
      // If we had buffered CLI lines, flush them before the fence
      flushCliBuffer();
      inExistingFence = !inExistingFence;
      result.push(line);
      continue;
    }

    // Inside an existing code fence — pass through untouched
    if (inExistingFence) {
      result.push(line);
      continue;
    }

    // Outside any fence — check if this line looks like CLI
    if (isCliLine(line)) {
      cliBuffer.push(line);
    } else {
      // Non-CLI line encountered — flush any buffered CLI lines
      flushCliBuffer();
      result.push(line);
    }
  }

  // Flush any remaining buffered CLI lines at end of text
  flushCliBuffer();

  return result.join('\n');
}
