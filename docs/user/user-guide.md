# User Guide

Everything you need to know about the Logseq Mixer interface — what every button does, how to configure settings, and how to troubleshoot common issues.

---

## Chat Panel Overview

Click the Mixer toolbar icon in Logseq to open the chat panel:

```
┌──────────────────────────────────────────────────────┐
│  [Logo] Mixer    [Model Selector ▾]  [✨ New]  [✕]  │
├──────────────────────────────────────────────────────┤
│                                                      │
│  (Chat messages appear here)                         │
│                                                      │
├──────────────────────────────────────────────────────┤
│  [📇][✏️][🤖]              [🗄️][🔌][🧠][Re-Index]  │
│  📄 Page Name ▸ Block preview...                     │
├──────────────────────────────────────────────────────┤
│  [📎]  Type your message...              [Send ▶]   │
└──────────────────────────────────────────────────────┘
```

The panel can be resized by dragging its left edge. Width persists across sessions (min 320px, max 85%, default 520px).

---

## Header Bar

| Element | What it does |
|---|---|
| **Model Selector** | Switch between LLM models on the fly. Dynamically fetches available models from your configured provider (OpenAI, Ollama, or LiteLLM). Remembers your last selected model per provider. |
| **✨ New** | Start a fresh conversation. If auto-summarize is enabled, the current session is saved to memory first. |
| **✕** | Close the chat panel. |

---

## Toggles (Left Side)

These control what the AI *can do* in response to your messages.

| Toggle | Icon | Effect |
|---|---|---|
| **Auto-Embed** | 📇 | Automatically indexes pages you edit in the background. Turn off for manual-only indexing. |
| **Direct Page Edit** | ✏️ | The AI can directly insert, update, and delete blocks on your current page. Off = chat-only responses. |
| **Agent** | 🤖 | Complex multi-step requests trigger the autonomous agent (planning, execution, self-correction). Off = single-turn chat only. |
| **Verbose** | 📋 | Show detailed agent progress: step type badges, token usage, correction reasoning, and error details. On by default. |

> **Tip:** Hover over any toggle to see its name.

---

## Action Buttons (Right Side)

| Button | Opens |
|---|---|
| **🗄️** | **Database Center** — Index stats (pages, chunks, DB size), export/import/clear actions |
| **🔌** | **MCP Servers** — Manage external tool connections (web search, file system, browser) |
| **🧠** | **Memory Manager** — View, edit, and delete stored memories. Badge shows memory count. |
| **Re-Index** | Triggers incremental re-indexing. Only processes new/changed pages; automatically purges stale entries from deleted pages. Becomes "Stop" during active indexing. |

---

## Input Area

| Element | What it does |
|---|---|
| **📎** | Attach files (text, code, CSV) or images to your message |
| **🗑️** | Clear input history — removes all saved previous inputs (only appears when history exists) |
| **Text Area** | Type your message. Enter sends, Shift+Enter for newline, Arrow Up/Down navigates input history. |
| **Send ▶** | Send message. Transforms to Cancel while AI is responding. |
| **Page/Block Indicator** | Shows the active page (📄) and focused block (▸) — this is what Direct Page Edit targets. |

### Persistent Input History

Your chat inputs are automatically saved and persist across sessions — even after closing and reopening Logseq. Use Arrow Up/Down to navigate through previously sent messages.

- **Storage:** Last 100 inputs saved in browser localStorage
- **Navigation:** Arrow Up (at cursor position 0) goes back, Arrow Down goes forward
- **Clear:** Click the tiny 🗑️ button next to the attach icon to erase all history
- **Tooltip:** Hover over the clear button to see how many entries are stored

---

## Chat Messages

Each message displays a header showing timestamp, role, and model in bracket format: `[2026-07-19T14:32:05 AI gpt-4o]` or `[2026-07-19T14:31:21 U]`.

---

## Status Indicators

| Indicator | Meaning |
|---|---|
| **💭 ...** | The AI is reasoning through a ReAct tool chain (thinking → acting → observing) |
| **⏳ Summarizing** | Background session summarization in progress (after clicking "New") |
| **💾 Remembered** | The AI just stored an explicit memory |

---

## Direct Page Edit Mode

Turn your AI into a co-author that directly modifies your graph.

1. Toggle **✏️ ON**
2. Click into the page/block you want edited
3. Confirm the page indicator shows the correct target
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

When using Direct Page Edit with an attached image:
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
| `/help page edit` | How Direct Page Edit works |
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
| **Selected Model** | `gpt-4o` | Model name passed to LiteLLM |
| **API Key** | — | Your LLM provider API key |
| **LiteLLM api link** | `http://127.0.0.1:4000/chat/completions` | LiteLLM proxy endpoint |
| **AI prompt** | (default template) | System prompt — customize AI behavior |

### Embedding (RAG Search)

| Setting | Default | Description |
|---|---|---|
| **Embedding Provider** | `openai` | `openai`, `ollama`, or `litellm` |
| **Embedding AI ApiKey** | — | API key for embeddings (not needed for Ollama) |
| **Embedding Model** | `text-embedding-3-small` | Model for generating vector embeddings |
| **Embedding API Endpoint** | `https://api.openai.com/v1/embeddings` | Embedding API URL |
| **Indexing Mode** | `incremental` | `incremental` (only changes) or `full` (rebuild everything) |
| **Storage Backend** | `sqlite` | `sqlite` (recommended) or `settings` (legacy Orama) |

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

### MCP Servers

| Setting | Format | Example |
|---|---|---|
| **MCP Servers Configuration** | JSON object | `{"server-name": {"url": "http://localhost:3002/sse"}}` |
| **MCP Tool Call Timeout (seconds)** | `180` | Max wait time for an MCP tool call. Increase for slow tools like browser automation (Playwright). |

### PlantUML

| Setting | Default | Description |
|---|---|---|
| **PlantUML Server URL** | `https://www.plantuml.com/plantuml` | The server endpoint for rendering PlantUML diagrams. For privacy, self-host: `docker run -p 8080:8080 plantuml/plantuml-server:jetty` and set to `http://localhost:8080`. |

---

## Troubleshooting

### "No active page" warning

**Cause:** You're on the journal home view without clicking into a block.
**Fix:** Click into any block — the page indicator will update to show the target.

### Direct Page Edit doesn't do anything

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
