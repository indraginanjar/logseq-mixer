/**
 * Built-in "mixer-help" skill — provides comprehensive Logseq Mixer documentation
 * to the AI so it can answer questions about Mixer features, commands, and workflows.
 *
 * This skill is auto-created on first load and updated when the plugin version changes.
 */

import { getSkill, saveSkill } from './SkillStore';

const BUILTIN_SKILL_VERSION = '1.0';

const MIXER_HELP_BODY = `# Logseq Mixer Documentation

You are answering questions about Logseq Mixer — an autonomous AI agent that lives inside a Logseq knowledge graph. Use this reference to provide accurate, specific answers.

## Core Concepts

Logseq Mixer is a plugin that adds AI capabilities to Logseq:
- **Chat interface**: A resizable side panel for conversing with AI about your notes
- **RAG retrieval**: Hybrid search (vector + BM25) over indexed graph content
- **Direct Page Edit**: AI can create/edit/delete blocks on the active page
- **Autonomous Agent**: Multi-step goal planning and execution
- **Memory**: Persistent preferences and session summaries across conversations
- **Skills**: Specialized instruction sets for specific tasks (agentskills.io compatible)
- **MCP Tools**: External tool integration via Model Context Protocol

## Chat Interface

### Header Bar
- **Model Selector**: Choose the LLM model (dropdown)
- **✨ New**: Start a fresh session (auto-summarizes previous conversation)
- **✕**: Close the panel

### Toggles (Left side of toolbar)
- **📇 Auto-Embed**: Auto-indexes pages when edited
- **✏️ Direct Page Edit**: Allows AI to modify blocks on the active page
- **🤖 Agent**: Enables autonomous multi-step execution
- **📢 Verbose**: Shows detailed agent step outputs

### Action Buttons (Right side of toolbar)
- **🗄️ Database**: Index stats, export/import/clear database
- **🔌 MCP Servers**: Manage external tool connections
- **🧠 Memory**: View/edit/delete stored memories
- **🧩 Skills**: Manage agent skills (enable/disable, import, create)
- **🔄 Re-Index**: Incremental re-indexing (only new/changed pages)

### Input Area
- **📎**: Attach text files or images
- **Send**: Send message (Enter key)
- **Page indicator**: Shows active page (📄) and focused block (▸)

## Slash Commands

| Command | Action |
|---------|--------|
| /help | Show help topics |
| /help <topic> | Get help on specific topic |
| /tools | List available built-in Logseq tools |
| /skill <name> | Activate a skill for the session |
| /skill <name> <message> | Activate skill and process message |
| /raw <prompt> | Send directly to LLM (no RAG/memory/context) |

## Direct Page Edit

### How to use:
1. Toggle ✏️ ON
2. Click into target block/page in Logseq
3. Verify the page indicator shows correct target
4. Type editing instruction (e.g., "Add a TODO for tomorrow's meeting")
5. AI executes via Logseq API — inserts, updates, or deletes blocks

### What it can do:
- Insert new blocks (nested at any depth)
- Update existing block content
- Delete blocks
- Create new pages with content
- Modify block properties

### Important:
- Only works on the page shown in the indicator
- Changes are immediately applied (no undo in Mixer, but Logseq has undo)
- Toggle OFF when you just want chat responses without edits

## Agent Mode

### How it works:
1. Toggle 🤖 ON
2. Give a complex instruction (e.g., "Find all my ML notes and create a summary page")
3. Agent detects the goal and generates a plan
4. In plan-first mode: approve the plan before execution
5. Steps execute with live progress (✅ done, 🔄 running, ⏳ pending)
6. Failed steps show Retry/Skip buttons

### Settings:
- **Autonomy**: plan-first (shows plan) or autopilot (executes immediately)
- **Confidence Threshold**: 0.0-1.0, how aggressive goal detection is (default 0.6)
- **Token Budget**: Max tokens per goal (default 100,000, 0 = unlimited)
- **Max Retries**: How many times to retry failed steps (default 2)
- **Fast Model**: Optional lightweight model for gather/extract steps

### Capabilities:
- Search pages by name
- Read full page block trees
- Insert/update/delete blocks
- Create new pages
- Activate skills
- Call MCP tools
- Delegate subtasks to subagents
- Self-correct when output quality is inadequate
- Replan when new information is discovered

## Memory System

### How it works:
- **Explicit**: Say "Remember that I prefer TypeScript" → stored as preference
- **Auto-summarize**: Click ✨ New → previous session auto-summarized and stored
- **Retrieval**: Memories injected into context via keyword matching + RAG

### Managing:
- Click 🧠 to view all memories
- Categories: preferences, session summaries, facts
- Edit or delete individual entries
- Budget: configurable % of context window (default 10%)

## Skills System

### What skills are:
Specialized instruction sets that give the AI focused expertise for specific tasks. Stored as Logseq pages under Mixer/Skills/.

### Activation:
- **/skill <name>**: Explicit activation via slash command
- **Automatic**: AI activates when task matches skill description
- **Tool call**: AI calls activate_skill during multi-step tasks

### Creating skills:
- **Panel**: Click 🧩 → "Create New Skill" form
- **Chat (AI-generated)**: "Create a skill called X that does Y"
- **From block**: "Create a skill from block ((uuid)) named X"

### Importing:
- **Panel**: Paste GitHub URL → Import
- **Chat**: "Import skill from https://github.com/..."
- Supports: repo URLs, blob URLs, tree URLs, raw URLs

### Skill format:
\`\`\`
Page: Mixer/Skills/skill-name

name:: skill-name
description:: What it does and when to use it.
enabled:: true
\`\`\`
Body content = the instructions the AI receives when skill is activated.

### Subagent delegation:
Skills can instruct the AI to use mixer_run_subtask for complex sub-tasks that benefit from isolated context.

## MCP Tools

### Setup:
1. Run an MCP server (e.g., supergateway wrapping an MCP tool)
2. Configure in Settings → mcpServers (JSON):
   \`{"server-name": {"url": "http://localhost:3001/sse"}}\`
3. Click 🔌 to verify connection and see available tools

### Common setups:
- Web search: supergateway + @anthropic/mcp-web-search
- Browser: supergateway + @playwright/mcp
- File system: supergateway + @anthropic/mcp-filesystem

## Provider Setup

### OpenAI (simplest):
- Chat Provider: openai
- API Key: your key
- Endpoint: https://api.openai.com/v1/chat/completions (default)

### Ollama (local, free):
- Chat Provider: ollama
- No API key needed
- Endpoint: http://localhost:11434/api/chat
- Pull models: \`ollama pull llama3.2\`

### LiteLLM (100+ providers):
- Chat Provider: litellm
- Endpoint: http://127.0.0.1:4000/chat/completions
- Run: \`litellm --model gpt-4o --port 4000\`

### Embedding:
- Provider: openai / ollama / litellm
- OpenAI endpoint: https://api.openai.com/v1/embeddings (default)
- Ollama endpoint: http://localhost:11434/api/embeddings
- LiteLLM endpoint: http://127.0.0.1:4000/embeddings

## Indexing

- **Re-Index button**: Processes only new/changed pages (incremental)
- **Auto-Embed toggle**: Auto-indexes when you edit pages
- **Debounce**: Configurable wait time before auto-index starts (default 300s)
- **Full re-index**: Only happens when chunking algorithm version changes
- **Garbage collection**: Automatically removes index entries for deleted pages

## File Attachments

- Click 📎 or Ctrl+V to attach
- Supported: PNG, JPG, GIF, text, code, CSV, MD, JSON
- Images sent to vision-capable models
- Text files included as context
- Click attached file badges to re-attach from history

## Charts & Diagrams

- AI can generate Mermaid diagrams in chat (code block with \`mermaid\` language)
- AI can generate PlantUML diagrams
- AI can generate inline SVG graphics
- Tabbed panels: Preview / Code view
- Copy as image (PNG) or source code

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Enter | Send message |
| Shift+Enter | New line |
| Arrow Up/Down | Navigate input history |
| Ctrl+V | Paste image |
| Escape | Close open panels |

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "No active page" warning | Click into a block in Logseq first |
| Direct Page Edit not working | Ensure ✏️ is ON and page indicator shows target |
| Agent too aggressive | Increase confidence threshold in settings |
| Agent not triggering | Lower confidence threshold, or ensure 🤖 is ON |
| Models not in dropdown | Check LiteLLM proxy is running |
| Indexing seems stuck | Click Re-Index button (shows "Stop" if running) |
| Memory not working | Check 🧠 Memory setting is enabled in plugin settings |
| Skills not appearing | Check skillsEnabled is true in settings |
| Import fails | Verify the GitHub URL points to a valid SKILL.md file |
`;

/**
 * Ensure the built-in mixer-help skill exists and is up to date.
 * Called during plugin initialization.
 */
export async function ensureBuiltinHelpSkill(): Promise<void> {
  try {
    const existing = await getSkill('mixer-help');

    // Create if missing, or update if version changed
    if (!existing || existing.version !== BUILTIN_SKILL_VERSION) {
      await saveSkill({
        name: 'mixer-help',
        description: 'Answer questions about Logseq Mixer features, commands, settings, workflows, troubleshooting, and configuration. Activate when the user asks how to use Mixer, what a button does, how to set up providers, or needs help with any Mixer feature.',
        enabled: true,
        body: MIXER_HELP_BODY,
        version: BUILTIN_SKILL_VERSION,
        source: 'builtin',
      });
      console.info('[Skills] Built-in mixer-help skill created/updated.');
    }
  } catch (err) {
    console.warn('[Skills] Failed to ensure builtin help skill:', err);
  }
}
