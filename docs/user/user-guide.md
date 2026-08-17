# User Guide

Everything you need to know about the Logseq Mixer interface — what every button does, how to configure settings, and how to troubleshoot common issues.

---

## Chat Panel Overview

Click the Mixer toolbar icon in Logseq to open the chat panel:

```
┌─────────────────────────────────────────────────────────────┐
│  [Logo] Mixer    [Model ▾] [⚡Effort ▾]  [✨ New]  [✕]     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  (Chat messages appear here)                                │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  [📇][✏️][🤖]        [🗄️][🔌][🧠][🧩][📊][Re-Index]       │
│  📄 Page Name ▸ Block preview...                            │
├─────────────────────────────────────────────────────────────┤
│  [📎]  Type your message...              [Send ▶]          │
└─────────────────────────────────────────────────────────────┘
```

The panel can be resized by dragging its left edge. Width persists across sessions (min 320px, max 85%, default 520px).

---

## Header Bar

| Element | What it does |
|---|---|
| **Agent Selector** | Switch between configured agent personalities. Each agent can have its own system prompt, model, provider, MCP tool states, and skill activations. The active agent's name and icon are shown. Click to open the dropdown; select "Manage Agents →" to create, edit, or delete agents. See [Agents](#agents) below. |
| **Model Selector** | Switch between LLM models on the fly. Dynamically fetches available models from your configured provider (OpenAI, Ollama, or LiteLLM). Remembers your last selected model per provider. **Note:** If the active agent specifies a model override, that takes precedence over this selector. |
| **⚡ Effort Selector** | Control how much "thinking" the model does before responding. Five levels from Low (fastest/cheapest) to Max (deepest reasoning). See [Reasoning Effort](#reasoning-effort) below. |
| **✨ New** | Start a fresh conversation. If auto-summarize is enabled, the current session is saved to memory first. |
| **✕** | Close the chat panel. |

---

## Toggles (Left Side)

These control what the AI *can do* in response to your messages.

| Toggle | Icon | Effect |
|---|---|---|
| **Auto-Embed** | 📇 | Automatically indexes pages you edit in the background. Turn off for manual-only indexing. |
| **Allow Graph Edits** | ✏️ | The AI can directly insert, update, and delete blocks on your current page. Off = chat-only responses. |
| **Agent** | 🤖 | Complex multi-step requests trigger the autonomous agent (planning, execution, self-correction). Off = single-turn chat only. |
| **Verbose** | 📋 | Show detailed agent progress: step type badges, token usage, correction reasoning, and error details. On by default. |

> **Tip:** Hover over any toggle to see its name.

---

## Action Buttons (Right Side)

| Button | Opens |
|---|---|
| **🗄️** | **Database Center** — Index stats (pages, chunks, DB size), export/import/clear actions |
| **🔌** | **MCP Servers** — Manage external tool connections. Add servers with ➕, remove with 🗑️, enable/disable per server and per tool, or edit raw JSON config. |
| **🧠** | **Memory Manager** — View, edit, and delete stored memories. Badge shows memory count. |
| **🧩** | **Skills Manager** — Enable/disable skills, import from GitHub, create new skills. Badge shows active skill count. See [Agent Skills](skills.md). |
| **📊** | **Token Usage** — View token consumption stats across all conversations. See [Token Usage Tracking](#token-usage-tracking) below. |
| **Re-Index** | Triggers incremental re-indexing. Only processes new/changed pages; automatically purges stale entries from deleted pages. Becomes "Stop" during active indexing. |

---

## Input Area

| Element | What it does |
|---|---|
| **📎** | Attach files (text, code, CSV) or images to your message |
| **🗑️** | Clear input history — removes all saved previous inputs (only appears when history exists) |
| **Text Area** | Type your message. Enter sends, Shift+Enter for newline, Arrow Up/Down navigates input history. |
| **Send ▶** | Send message. Transforms to Cancel while AI is responding. |
| **Page/Block Indicator** | Shows the active page (📄) and focused block (▸). This page's full content is always included as context in every AI request, ensuring the model has full awareness of what you're looking at. Also serves as the target for Allow Graph Edits commands. |

### Persistent Input History

Your chat inputs are automatically saved and persist across sessions — even after closing and reopening Logseq. Use Arrow Up/Down to navigate through previously sent messages.

- **Storage:** Last 100 inputs saved in browser localStorage
- **Navigation:** Arrow Up (at cursor position 0) goes back, Arrow Down goes forward
- **Clear:** Click the tiny 🗑️ button next to the attach icon to erase all history
- **Tooltip:** Hover over the clear button to see how many entries are stored

---

## Chat Messages

Each message displays a header showing timestamp, role, and model in bracket format: `[2026-07-19T14:32:05 AI gpt-4o]` or `[2026-07-19T14:31:21 U]`.

Assistant messages also show a completion footer with token usage: `✓ 2026-08-13T12:53:26  ↑1,234 ↓567` — where ↑ is input tokens sent and ↓ is output tokens received. This appears automatically for every AI response.

---

## Status Indicators

| Indicator | Meaning |
|---|---|
| **💭 ...** | The AI is reasoning through a ReAct tool chain (thinking → acting → observing) |
| **⏳ Summarizing** | Background session summarization in progress (after clicking "New") |
| **💾 Remembered** | The AI just stored an explicit memory |

---

## Token Usage Tracking

Mixer automatically tracks token consumption across all LLM API calls, giving you visibility into how much context you're using and what it costs.

### Per-Message Token Display

Every assistant message shows token counts in the completion footer:

```
✓ 2026-08-13T12:53:26  ↑1,234 ↓567
```

| Symbol | Meaning |
|---|---|
| **↑** | Input tokens — the total prompt size sent to the model (system prompt + context + your message) |
| **↓** | Output tokens — the number of tokens the model generated in its response |

These counts come directly from the API response when available. For providers that don't return usage data, Mixer falls back to local token estimation.

### Token Usage Panel

Click **📊** in the right-side toolbar to open the Token Usage panel. It provides a comprehensive breakdown of your LLM consumption:

**All-time summary (top of panel):**
- Total input tokens consumed
- Total output tokens generated
- Total API calls made

**Tabbed period views:**

| Tab | Shows |
|---|---|
| **Daily** | Usage for each day |
| **Weekly** | Usage aggregated by week |
| **Monthly** | Usage aggregated by month |
| **Yearly** | Usage aggregated by year |
| **All Time** | Cumulative totals |

Each period row displays:
- Input tokens
- Output tokens
- Total tokens (input + output)
- API call count

**Clear All** — Resets all stored usage data. This is irreversible.

### How Tracking Works

- **Automatic** — Every LLM API call (chat completions, embeddings are excluded) is logged without any configuration.
- **Accurate** — Uses actual token counts reported by the provider's API response (`usage.prompt_tokens`, `usage.completion_tokens`). When the API doesn't return usage data (some Ollama models, custom endpoints), Mixer estimates counts locally.
- **Persistent** — Token usage is stored in the same SQLite database as the vector index, persisted across sessions via IndexedDB. Your data survives browser restarts, Logseq reloads, and plugin updates.
- **Per-provider** — All providers (OpenAI, Ollama, LiteLLM) are tracked through the same system.

> **Tip:** Use the token display to understand your context budget. If ↑ numbers are consistently high, consider trimming your system prompt or reducing the memory token budget in settings.

---

## Allow Graph Edits Mode

Turn your AI into a co-author that directly modifies your graph.

1. Toggle **✏️ ON**
2. Click into the page/block you want edited
3. Confirm the page indicator shows the correct target (the AI always sees this page's content as context)
4. Type your instruction (e.g., "add a summary section" or "reorganize by priority")
5. The AI sends structured edit commands executed via Logseq's API
6. A change summary shows exactly what was created or modified

> **Important:** The AI can only edit the page shown in the indicator. If you're on the journal home view, click into a specific block first.

---

## File & Image Attachments

### Attaching Files

| Method | How |
|---|---|
| **File picker** | Click 📎, select one or more files |
| **Paste image** | Ctrl+V with an image in clipboard |
| **Re-attach** | Click the 📎 badge on a previous message |

### Supported Types

| Type | Behavior |
|---|---|
| **Images** (PNG, JPG, GIF) | Displayed as thumbnail. Sent as vision content (requires vision-capable model). |
| **Text files** (code, CSV, TXT, MD, JSON) | Read as text and appended to your message as context. |
| **Binary files** (PDF, DOCX, ZIP) | Not supported — use text-based formats. |

### Inserting Images into Pages

When using Allow Graph Edits with an attached image:
1. The image appears in chat with a **"📋 Copy Image"** button
2. Click to copy to clipboard
3. Click the target block in Logseq and press **Ctrl+V**
4. Logseq saves it to `assets/` and inserts the markdown reference

---

## Charts & Visuals

The AI can generate visual content directly in chat.

### Supported Formats

| Format | Diagram Types | Rendering |
|---|---|---|
| **Mermaid** | Flowcharts, sequence diagrams, mindmaps, pie charts, gantt charts, ER diagrams, state diagrams | Client-side (bundled library) |
| **PlantUML** | Class diagrams, sequence diagrams, component diagrams, deployment diagrams, activity diagrams, use case diagrams | External server |
| **SVG** | Custom illustrations and diagrams | Inline rendering |

### Format Selection

The AI automatically chooses the best format based on your request:

| Best for Mermaid | Best for PlantUML |
|---|---|
| Flowcharts and process flows | UML class diagrams (methods, attributes, inheritance) |
| Mindmaps and tree structures | Complex sequence diagrams (lifelines, alt/opt blocks) |
| Pie charts and Gantt charts | Component and deployment diagrams |
| Simple ER diagrams | Activity diagrams with complex branching |
| State diagrams | Use case diagrams |

You can also explicitly request a format: "create a mermaid mindmap" or "generate a plantuml class diagram."

### Mermaid Diagram Panel

When the AI generates a Mermaid diagram, it appears in a tabbed panel:

| Tab | Description |
|---|---|
| **Preview** | Rendered diagram (click to activate rendering) |
| **Code** | Raw Mermaid source code |

### PlantUML Diagram Panel

PlantUML diagrams render via an external server (configurable in settings):

| Tab | Description |
|---|---|
| **Preview** | Rendered diagram (loads automatically from server) |
| **Code** | Raw PlantUML source code |

Actions available on both:
- **Copy** — Copy source code (in Code tab) or copy as PNG image (in Preview tab)
- **⛶ Maximize** — View the chart fullscreen

### Auto-Fix for Diagram Errors

If a generated diagram fails to render:

1. **Programmatic sanitizer** (Mermaid only) — fixes common syntax issues automatically
2. **AI-powered fixer** — The error + code are sent to the LLM for correction (up to 2 attempts)
3. **Manual retry** — A "🔧 Fix with AI" button lets you trigger another fix attempt

### Mermaid Diagram Limitations

| Limitation | Details |
|---|---|
| **No emoji in node labels** | Emoji characters crash the Mermaid renderer. They are automatically stripped. |
| **Mindmap coloring** | Mindmaps do not support per-node color styling. Colors are assigned by theme. |
| **Logseq links in output** | `[[page links]]` are automatically stripped before rendering. |
| **Large diagrams** | 8-second timeout — overly complex diagrams will show a timeout error. |

### PlantUML Diagram Limitations

| Limitation | Details |
|---|---|
| **Requires network** | Diagrams are rendered by an external server. Offline usage requires a self-hosted server. |
| **Privacy** | Diagram source code is sent to the configured server. For sensitive data, self-host the server. |
| **Self-hosting** | Run `docker run -p 8080:8080 plantuml/plantuml-server:jetty` and set the endpoint to `http://localhost:8080`. |
| **Error messages** | The PlantUML server returns error images rather than text — auto-fix relies on the LLM analyzing the code. |

### Tips for Better Diagrams

- **Be specific about diagram type:** "Create a flowchart showing..." or "Make a class diagram of..." gives better results.
- **Specify structure:** For mindmaps, describe the grouping you want (e.g., "group by status").
- **UML diagrams:** For class diagrams, component diagrams, or deployment diagrams, the AI will typically choose PlantUML automatically.
- **Colors in flowcharts work:** For Mermaid flowchart/graph diagrams, you can ask for colors.
- **Keep it focused:** Diagrams with too many nodes become unreadable. Ask to limit to a subset.

---

## Slash Commands

Mixer supports slash commands that provide utilities and shortcuts directly in the chat input. These are processed locally before reaching the AI.

### `/help` — In-Chat Help

Type `/help` for instant documentation without consuming RAG context:

| Command | Description |
|---|---|
| `/help` | List available help topics |
| `/help <topic>` | Get help on a specific feature |
| `/help page edit` | How Allow Graph Edits works |
| `/help agent` | Autonomous agent usage |
| `/help mcp tools` | MCP tool setup |
| `/help settings` | Settings quick reference |

### `/tools` — List Built-in Tools

Type `/tools` to see all built-in Logseq tools that the AI can use during conversations:

```
/tools
```

Displays each tool's name, description, and required parameters. This only shows the **built-in Logseq tools** (search, read, insert, update, delete, create pages). MCP tools are managed separately via the 🔌 panel.

Useful for understanding what the AI can do with your graph, or for debugging when a tool call doesn't work as expected.

### `/raw` — Send Prompt Without Context

Type `/raw <prompt>` to send your message directly to the LLM without any of Mixer's context enrichment:

```
/raw What is the capital of France?
/raw Explain the difference between TCP and UDP
/raw Write a haiku about programming
```

**What gets stripped:**
- ❌ No RAG retrieval (knowledge base search)
- ❌ No memory injection
- ❌ No page context
- ❌ No conversation history
- ❌ No tool calling (ReAct loop)
- ❌ No agent goal detection

**What remains:**
- ✅ System prompt (from settings)
- ✅ Your message (as-is)

**When to use:**
- Testing how the model responds without your notes influencing the answer
- Getting general knowledge answers uncontaminated by graph context
- Comparing raw model quality vs. RAG-enhanced responses
- Debugging — isolating whether an issue comes from context injection or the model itself
- Quick questions that don't need your notes at all

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| **Enter** | Send message |
| **Shift+Enter** | New line |
| **Arrow Up** | Navigate backward through input history (cursor must be at start) |
| **Arrow Down** | Navigate forward through input history (cursor must be at end) |
| **Ctrl+V** | Paste image from clipboard |
| **Escape** | Close overlay panels |

---

## Settings Reference

Open **Settings → Plugin Settings → Mixer**.

### LLM Connection

| Setting | Default | Description |
|---|---|---|
| **Chat Provider** | `openai` | `openai` \| `ollama` \| `litellm` — controls request format, endpoint default, and model fetching. |
| **Selected Model** | `gpt-4o` | Model name passed to the provider |
| **Reasoning Effort** | `high` | Controls how much thinking the model does. See [Reasoning Effort](#reasoning-effort) below. |
| **AI prompt** | (default template) | System prompt — customize AI behavior |
| **Streaming Responses** | `true` | Stream AI responses token-by-token as they are generated. See [Streaming Responses](#streaming-responses) below. |

#### Per-Provider Chat Settings

| Provider | Endpoint Setting | API Key Setting | Default Endpoint |
|---|---|---|---|
| **OpenAI** | `openaiEndpoint` | `openaiApiKey` | `https://api.openai.com/v1/chat/completions` |
| **Ollama** | `ollamaEndpoint` | `ollamaApiKey` | `http://localhost:11434/api/chat` |
| **LiteLLM** | `litellmEndpoint` | `litellmApiKey` | `http://127.0.0.1:4000/chat/completions` |

Leave endpoint empty to use the default. API key is optional for Ollama.

### Reasoning Effort

The **Reasoning Effort** setting (also accessible via the ⚡ dropdown in the header) controls how deeply the AI model reasons before responding. This maps to the `reasoning_effort` API parameter supported by modern LLM providers.

**Effort Levels:**

| Level | Label | Behavior | Best for |
|---|---|---|---|
| `low` | ⚡Low | Fastest, cheapest, minimal reasoning | Simple lookups, classification, quick answers |
| `medium` | ⚡Med | Balanced speed and quality | General chat, moderate complexity |
| `high` | ⚡High | Default — thorough reasoning | Complex questions, coding, analysis |
| `xhigh` | ⚡XH | Extended reasoning depth | Hard multi-step problems, agentic work |
| `max` | ⚡Max | Maximum capability, no constraints | Frontier problems requiring deepest analysis |

**Provider support:**

| Provider | Supported levels | How it's applied |
|---|---|---|
| **OpenAI** | `low`, `medium`, `high` | `reasoning_effort` parameter for o-series reasoning models (o1, o3, o4-mini). Non-reasoning models (GPT-4o) ignore it gracefully. |
| **Ollama** | All levels | Maps to Ollama's `think` option. `low` = thinking disabled, all others = thinking enabled. |
| **LiteLLM** | All levels | Automatically translated to each backend's native parameter (Anthropic's `effort`, Gemini's `thinkingLevel`, etc.) |

**Tips:**
- Start with `high` (the default) — it matches what all providers use by default.
- Use `low` for high-volume simple tasks where speed matters more than depth.
- Use `xhigh` or `max` for agent mode tasks that involve multi-step planning and tool use.
- Models that don't support reasoning effort simply ignore the parameter — no errors occur.
- The setting persists across sessions. Change it any time from the header dropdown.

### Streaming Responses

When **Streaming Responses** is enabled (the default), the AI's reply appears progressively in the chat — word by word as it's generated — rather than waiting for the entire response to complete before displaying anything.

**Benefits:**
- **Faster perceived response time** — you see the first words within ~200ms instead of waiting 5–30 seconds for the full answer.
- **Early cancellation** — if the response is clearly off-track, hit Cancel immediately without waiting for it to finish.
- **Natural reading pace** — text appears at roughly reading speed, making long responses easier to follow.

**When to disable:**
- Your provider doesn't support streaming (rare — OpenAI, Ollama, and LiteLLM all support it).
- You're behind a proxy that buffers Server-Sent Events (some corporate proxies do this).
- You prefer responses to appear all at once for copy-paste workflows.

**Technical notes:**
- Streaming is automatically disabled during **Allow Graph Edits** mode (✏️) because edit commands need to be parsed as a complete response before execution.
- When tools are being used (ReAct loop), intermediate tool-calling steps are not streamed. Only the final answer is streamed to the chat.
- If your provider returns a non-streaming response despite the streaming request (unsupported endpoint), the plugin gracefully falls back to displaying the complete response at once.

### Embedding (RAG Search)

| Setting | Default | Description |
|---|---|---|
| **Embedding Provider** | `openai` | `openai` \| `ollama` \| `litellm` |
| **Embedding Model** | `text-embedding-3-small` | Model for generating vector embeddings |
| **Indexing Mode** | `incremental` | `incremental` (only changes) or `full` (rebuild everything) |
| **Storage Backend** | `sqlite` | `sqlite` (recommended) or `settings` (legacy Orama) |

#### Per-Provider Embedding Settings

| Provider | Endpoint Setting | API Key Setting | Default Endpoint |
|---|---|---|---|
| **OpenAI** | `openaiEmbeddingEndpoint` | `openaiEmbeddingApiKey` | `https://api.openai.com/v1/embeddings` |
| **Ollama** | `ollamaEmbeddingEndpoint` | `ollamaEmbeddingApiKey` | `http://localhost:11434/api/embeddings` |
| **LiteLLM** | `litellmEmbeddingEndpoint` | `litellmEmbeddingApiKey` | `http://127.0.0.1:4000/embeddings` |

Leave endpoint empty to use the default. API key is not needed for local Ollama.

### Deprecated Settings

These settings are kept for backwards compatibility but will be removed in a future version. Use the per-provider settings above instead.

| Setting | Replaced by |
|---|---|
| API Key | OpenAI API Key / Ollama API Key / LiteLLM API Key |
| Chat API Endpoint | OpenAI Endpoint / Ollama Endpoint / LiteLLM Endpoint |
| LiteLLM api link | LiteLLM Endpoint |
| Embedding AI ApiKey | OpenAI Embedding API Key / Ollama Embedding API Key / LiteLLM Embedding API Key |
| Embedding API Endpoint | OpenAI Embedding Endpoint / Ollama Embedding Endpoint / LiteLLM Embedding Endpoint |

> **Migration from older versions:** The previous shared settings still work as fallbacks. Per-provider settings take priority when set. You can gradually migrate by setting the per-provider values — the old shared settings will be ignored once the new ones are configured.

### Auto-Indexing

| Setting | Default | Description |
|---|---|---|
| **Auto-Embed on Page Changes** | `true` | Automatically index pages when you edit them |
| **Auto-Index Debounce (seconds)** | `300` | Wait time after last edit before auto-indexing starts |

### Memory

| Setting | Default | Description |
|---|---|---|
| **Enable Agent Memory** | `true` | AI remembers context across sessions |
| **Auto-summarize Sessions** | `true` | Summarize conversations on "New Session" |
| **Memory Token Budget (%)** | `10` | Percentage of context window allocated for memories (1-25) |

### Conversation Context

Each message sent to the AI includes multiple context layers:

| Layer | Budget | Description |
|-------|--------|-------------|
| System prompt | Fixed | Base instructions from settings |
| Conversation history | ~20% of context | Last 6 messages from current session |
| Page context | ~25% of context | Block tree of active page |
| Memory | Configurable (default 10%) | Preferences, summaries, facts |
| RAG context | Remaining budget | Relevant chunks from indexed graph |

**Important:** The timestamps shown in the chat UI (e.g., `[2026-08-03T09:23:06 U]`) are display-only — they are **not** sent to the AI. The AI cannot reference messages by their timestamp. If you need to refer to earlier content that has been trimmed from history, copy-paste it into your new message.

The conversation history is limited to the last 6 messages to stay within token budgets. When you click **✨ New**, the session is summarized and stored in memory before being cleared — so key facts persist even across fresh sessions.

### Agent

| Setting | Default | Description |
|---|---|---|
| **Agent Mode** | `on` | Enable/disable autonomous goal pursuit |
| **Agent Autonomy Level** | `plan-first` | `plan-first` (approval required) or `autopilot` (immediate execution) |
| **Agent Confidence Threshold** | `0.6` | Goal detection sensitivity (lower = more triggers) |
| **Agent Token Budget** | `100000` | Max tokens per autonomous run |
| **Agent Max Tool Iterations** | `25` | Max ReAct iterations per query |
| **Agent Max Retries Per Step** | `2` | Retries before escalating to user |
| **Agent Verbose Mode** | `true` | Show step type badges, token usage, self-correction reasoning, and error details. Toggle via 📋 in the toolbar. |
| **Persist Agent Steps to Chat** | `false` | When Verbose Mode is on, stream each completed step as a chat message and keep full output in conversation context. |

### Agents

Mixer supports multiple agent personalities. Each agent is an independent configuration profile that overrides global settings when active.

#### Agent Selector vs. Agent Mode Toggle

These two controls are **independent and orthogonal**:

| Control | Location | What it controls |
|---|---|---|
| **Agent Selector** (dropdown) | Header bar | *Which* agent personality is active — determines system prompt, model, provider, tool access, and skills |
| **Agent Mode** (🤖 toggle) | Bottom toolbar | *How* the AI responds — whether it can autonomously plan and execute multi-step goals |

They combine freely:

| Agent Selector | Agent Mode | Behavior |
|---|---|---|
| "Research Agent" | ON | Uses Research Agent's prompt/model AND can execute multi-step plans |
| "Research Agent" | OFF | Uses Research Agent's prompt/model but only responds in single-turn chat |
| "Default" | ON | Uses default config AND can execute multi-step plans |
| "Default" | OFF | Standard single-turn chat with default settings |

> **Key point:** Switching agents does NOT toggle agent mode, and toggling agent mode does NOT change which agent is selected. They are separate dimensions.

#### What Each Agent Configures

| Field | Effect |
|---|---|
| **Name** | Display name in the selector dropdown |
| **Icon** | Emoji shown in the selector |
| **System Prompt** | Overrides the global "AI prompt" setting |
| **Model** | Overrides the Model Selector (leave empty to use global). Invalid values are ignored with fallback to global. |
| **Provider** | Overrides Chat Provider (must be `openai`, `ollama`, or `litellm`; invalid values fall back to global) |
| **MCP Tool States** | Per-agent enable/disable of individual MCP tools (configurable via checkboxes in the agent edit form) |
| **Skill Activations** | Skills automatically activated when this agent handles a query (configurable via checkboxes in the agent edit form) |

#### Managing Agents

Click **Manage Agents →** at the bottom of the Agent Selector dropdown (or click the Agent Selector when only one agent exists) to open the Agent Panel:

- **Create** a new agent with custom name, icon, system prompt, model/provider overrides, MCP tool access, and skill activations
- **Edit** an existing agent's configuration — including per-tool checkboxes for MCP access and per-skill checkboxes for auto-activation
- **Duplicate** an agent to create a variant
- **Delete** a non-default agent (the default agent cannot be deleted; deleting an agent also cleans up its stored conversation)

#### Conversation State per Agent

Each agent maintains its own conversation state. When you switch agents:
- The current agent's conversation (both UI messages and LLM history) is saved
- The target agent's previous conversation is restored
- Starting a "✨ New" session only clears the current agent's conversation

This means you can have different ongoing conversations with different agents and switch between them without losing context.

> **Storage limits:** Each agent's conversation is limited to the most recent 50 messages (approximately 500KB). If storage fills up, older messages are progressively trimmed. This prevents localStorage exhaustion when using many agents.

### MCP Servers

| Setting | Format | Example |
|---|---|---|
| **MCP Servers Configuration** | JSON object | `{"server-name": {"url": "http://localhost:3002/sse"}}` |
| **MCP Tool Call Timeout (seconds)** | `180` | Max wait time for an MCP tool call. Increase for slow tools like browser automation (Playwright). |

### Cross-Graph Search

Search across multiple Logseq graphs simultaneously. When enabled, RAG queries also search other graphs you've previously indexed.

| Setting | Default | Description |
|---|---|---|
| **Cross-Graph Search** | `false` | Enable searching other Logseq graphs' indexes during RAG retrieval |

**Setup:**
1. Enable **Cross-Graph Search** in plugin settings
2. Open the **🗄️ Database Center** panel
3. In the "🌐 Cross-Graph Search" section, click **➕ Add Graph**
4. Enter the graph's file system path and an optional label
5. Results from other graphs will appear with `[From: GraphName]` attribution

**⚠️ Limitations (important):**

| Limitation | What it means |
|---|---|
| **Snapshot-based** | Results come from the last time you opened that graph and indexed it. Not live data. |
| **Must re-index manually** | To update a cross-graph source, open it in Logseq and run Re-Index. |
| **Embedding model must match** | All graphs must be indexed with the same embedding model (e.g., `text-embedding-3-small`). Mismatched dimensions are silently skipped. |
| **Block refs not clickable** | Cross-graph `((uuid))` references cannot navigate to the source — they appear as text citations. |
| **Read-only** | The agent cannot write to other graphs. Only the active graph supports edits. |
| **Memory overhead** | Each cross-graph query opens an additional SQLite database temporarily. With many large graphs, this uses more RAM. |

### PlantUML

| Setting | Default | Description |
|---|---|---|
| **PlantUML Server URL** | `https://www.plantuml.com/plantuml` | The server endpoint for rendering PlantUML diagrams. For privacy, self-host: `docker run -p 8080:8080 plantuml/plantuml-server:jetty` and set to `http://localhost:8080`. |

---

## Troubleshooting

### "No active page" warning

**Cause:** You're on the journal home view without clicking into a block.
**Fix:** Click into any block — the page indicator will update. The active page's full content is always sent as context to the AI, so clicking into the relevant page helps the AI understand what you're working on.

### Allow Graph Edits doesn't do anything

**Cause:** ✏️ toggle is OFF, or the AI couldn't determine what to edit.
**Fix:** Ensure ✏️ is ON, confirm the page indicator is correct, and be specific in your instruction.

### Agent detects goals too aggressively

**Cause:** Confidence threshold is too low.
**Fix:** Increase `Agent Confidence Threshold` to 0.8, or toggle 🤖 OFF for simple conversations.

### Agent never activates

**Cause:** 🤖 toggle is OFF, or messages are too short/question-like.
**Fix:** Toggle 🤖 ON. Use imperative instructions: "Find all X and create Y" rather than "Can you find X?"

### MCP tool calls time out

**Cause:** The default timeout (180s) may not be enough for very slow tools, or the MCP server is unresponsive.
**Fix:** Increase `MCP Tool Call Timeout` in settings. For browser automation (Playwright), try 300s. Also check that the MCP server process is still running.

### Agent step output disappears after goal completes

**Cause:** By default, step-by-step output only shows in the progress panel during execution and is replaced by a summary at completion.
**Fix:** Enable `Persist Agent Steps to Chat` in settings (requires Verbose Mode to be ON). Each completed step will stream as a chat message and remain visible in the conversation history.

### Models not showing in dropdown

**Cause:** The configured provider isn't reachable or the endpoint is wrong.
**Fix:** Check that your provider is running and the endpoint in settings is correct. The model dropdown fetches from whichever provider is configured: OpenAI (`/v1/models`), Ollama (`/api/tags`), or LiteLLM (`/models`).

### Re-Index takes too long

**Cause:** First-time indexing processes your entire graph.
**Fix:** Normal for large graphs. Click "Stop" to pause — progress is saved. Subsequent runs are fast (incremental).

### Stale block references in chat responses

**Cause:** Pages were deleted from your graph but their old index entries hadn't been cleaned up yet.
**Fix:** Click **Re-Index**. The incremental indexer now automatically detects and purges entries from deleted pages before processing updates. No full re-index or database clear is needed — the garbage collection step runs in under a second.

### Chat input unresponsive

**Cause:** Focus was lost after a panel action (rare).
**Fix:** Click directly in the text area to restore focus.

---

## Related Documentation

- [Getting Started](https://github.com/indraginanjar/logseq-mixer/blob/main/docs/user/getting-started.md) — Installation and first-time setup
- [Agentic AI](https://github.com/indraginanjar/logseq-mixer/blob/main/docs/user/agentic-ai.md) — Agent capabilities and memory
- [MCP Tools](https://github.com/indraginanjar/logseq-mixer/blob/main/docs/user/mcp-tools.md) — External tool configuration
