/**
 * /tools command — lists available built-in Logseq tools (excludes MCP tools).
 */

import { LOGSEQ_TOOLS } from './agent/logseqTools';

/**
 * Check if a message is a /tools command.
 */
export function isToolsCommand(message: string): boolean {
  const lower = message.trim().toLowerCase();
  return lower === '/tools';
}

/**
 * Generate a formatted list of built-in Logseq tools.
 */
export function listBuiltInTools(): string {
  const header = '**🔧 Built-in Logseq Tools**\n\nThese tools are always available to the AI during conversations:\n';

  const toolLines = LOGSEQ_TOOLS.map(tool => {
    const name = tool.function.name;
    const desc = tool.function.description.split('\n')[0]; // First line only
    const params = tool.function.parameters.required?.join(', ') || 'none';
    return `- **${name}** — ${desc}\n  Parameters: \`${params}\``;
  });

  const footer = '\n\n*These tools are used automatically by the AI in the ReAct loop. MCP tools are managed separately via the 🔌 panel.*';

  return header + toolLines.join('\n') + footer;
}
