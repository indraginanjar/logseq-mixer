import { queryLiteLLM, type ChatMessage } from 'LLMManager';

const USER_GUIDE = `
# Logseq Mixer Quick Help

## Chat Window Toggles
- 📇 Auto-Embed: auto-indexes pages when you edit them
- ✏️ Direct Page Edit: allows AI to create/edit/delete blocks on your current page (OFF = chat-only responses)
- 🤖 Agent: enables autonomous multi-step goal pursuit

## Action Buttons
- 🗄️ Database Center: view index stats, export/import/clear database
- 🔌 MCP Servers: manage external tool connections
- 🧠 Memory: view/edit/delete stored memories
- Re-Index: trigger incremental re-indexing of your graph

## How to Use Direct Page Edit
1. Toggle ✏️ ON
2. Click into the target block/page in Logseq
3. Confirm the page indicator shows the correct target
4. Type your editing instruction
5. AI executes edits via Logseq API

## How the Agent Works
1. Toggle 🤖 ON
2. Give a complex multi-step instruction
3. Plan appears → click "▶️ Approve" (plan-first mode)
4. Steps execute with live progress
5. Failed steps show Retry/Skip buttons

## Memory
- Say "Remember this: ..." to store explicit memories
- Sessions auto-summarize when you click "✨ New"
- Click 🧠 to manage stored memories
- Memories are injected into context automatically

## MCP Tools Setup
1. Run an MCP server: npx -y supergateway --port 3002 --stdio "npx -y @playwright/mcp@latest"
2. Settings → mcpServers: {"name": {"url": "http://localhost:3002/sse"}}
3. Click 🔌 to verify connection

## File Attachments
- Click 📎 to attach text files or images
- Ctrl+V to paste images from clipboard
- Supported: PNG, JPG, GIF, text, code, CSV, MD, JSON

## Charts
- AI can generate Mermaid diagrams and SVG graphics in chat
- Use 📄 SVG / 🖼️ PNG buttons to copy charts

## Settings Quick Reference
- Selected Model: model name for LiteLLM (e.g. gpt-4o)
- LiteLLM api link: http://127.0.0.1:4000/chat/completions
- Embedding Provider: openai / ollama / litellm
- Embedding Endpoint: for LiteLLM use http://127.0.0.1:4000/embeddings
- Agent Mode: on/off
- Agent Autonomy: plan-first (shows plan) / autopilot (executes immediately)
- Agent Token Budget: max tokens per goal (default 100000)

## Keyboard Shortcuts
- Enter: send message
- Shift+Enter: new line
- Arrow Up: recall previous message
- Ctrl+V: paste image
- Escape: close panels

## Slash Commands
- /help: show help topics
- /help <topic>: get help on a specific topic
- /tools: list available built-in Logseq tools
- /raw <prompt>: send prompt directly to LLM without RAG, memory, or context

## Troubleshooting
- "No active page": click into a block first
- Direct Page Edit not working: ensure ✏️ is ON and page indicator shows target
- Agent too aggressive: increase confidence threshold in settings
- Models not in dropdown: check LiteLLM proxy is running
`;

/**
 * Check if a message is a help command.
 * Supports: /help, /help <topic>, /?, help me with mixer
 */
export function isHelpCommand(message: string): boolean {
  const lower = message.trim().toLowerCase();
  return lower === '/help' || lower === '/?' || lower.startsWith('/help ');
}

/**
 * Extract the help topic from a help command.
 */
function extractHelpTopic(message: string): string {
  const lower = message.trim().toLowerCase();
  if (lower === '/help' || lower === '/?') return '';
  return message.trim().slice(6).trim(); // remove "/help "
}

/**
 * Answer a help question about Logseq Mixer.
 * Uses the embedded user guide as context — no RAG needed.
 */
export async function answerHelpQuestion(message: string, settings: any): Promise<string> {
  const topic = extractHelpTopic(message);

  if (!topic) {
    // Return the quick reference
    return `**Logseq Mixer Help** — Type \`/help <topic>\` for specific help.\n\nAvailable topics: page edit, agent, memory, mcp tools, settings, attachments, charts, shortcuts, troubleshooting\n\nOr ask a question: \`/help how do I use Direct Page Edit?\``;
  }

  // Use LLM to answer based on the embedded guide
  if (!settings?.selectedModel || !(settings?.chatEndpoint || settings?.LiteLLMLink)) {
    // No LLM available, return raw guide section
    return searchGuideManually(topic);
  }

  try {
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `You are a help assistant for the Logseq Mixer plugin. Answer the user's question based ONLY on the following documentation. Be concise and practical. If the answer isn't in the docs, say so.\n\n${USER_GUIDE}`,
      },
      { role: 'user', content: topic },
    ];
    const result = await queryLiteLLM(messages, settings.selectedModel, settings.apiKey, settings.chatEndpoint || settings.LiteLLMLink, undefined, undefined, settings.chatProvider);
    return result.choices?.[0]?.message?.content?.trim() || searchGuideManually(topic);
  } catch {
    return searchGuideManually(topic);
  }
}

/** Simple keyword search fallback when LLM isn't available */
function searchGuideManually(topic: string): string {
  const lower = topic.toLowerCase();
  const sections = USER_GUIDE.split('\n## ');
  const matches = sections.filter(s => s.toLowerCase().includes(lower));
  if (matches.length > 0) {
    return matches.map(s => '## ' + s.trim()).join('\n\n');
  }
  return 'No help found for that topic. Try: /help page edit, /help agent, /help memory, /help settings, /help mcp tools';
}
