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

---

## Header Bar

| Element | What it does |
|---|---|
| **Model Selector** | Switch between LLM models on the fly. Fetches available models from your LiteLLM server automatically. |
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
| **Re-Index** | Triggers incremental re-indexing. Only processes new/changed pages. Becomes "Stop" during active indexing. |

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

| Format | Diagram Types |
|---|---|
| **Mermaid** | Flowcharts, sequence diagrams, mindmaps, pie charts, gantt charts, ER diagrams, state diagrams, and more |
| **SVG** | Custom illustrations and diagrams |

### Mermaid Diagram Panel

When the AI generates a Mermaid diagram, it appears in a tabbed panel:

| Tab | Description |
|---|---|
| **Preview** | Rendered diagram (click to activate rendering) |
| **Code** | Raw Mermaid source code |

Actions available:
- **Copy** — Copy source code (in Code tab) or copy as PNG image (in Preview tab)
- **⛶ Maximize** — View the chart fullscreen

### Auto-Fix for Mermaid Errors

If a generated Mermaid diagram fails to render:

1. **Programmatic sanitizer** runs first — fixes common syntax issues automatically (no LLM call needed)
2. **AI-powered fixer** — If sanitizer can't fix it, the error + code are sent to the LLM for correction (up to 2 attempts)
3. **Manual retry** — A "🔧 Fix with AI" button lets you trigger another fix attempt

### Mermaid Diagram Limitations

The following are known limitations of Mermaid diagram generation in Logseq Mixer:

| Limitation | Details |
|---|---|
| **No emoji in node labels** | Emoji characters (🟩🟨🟧✅❌ etc.) crash the Mermaid renderer. They are automatically stripped by the sanitizer. |
| **Mindmap coloring** | Mindmaps do not support per-node color styling (`:::className` or `style` lines). Colors are assigned automatically by the theme based on branch depth. |
| **Logseq links in output** | The AI may copy `[[page links]]` from your notes into diagram code. These are automatically stripped before rendering. |
| **Large diagrams** | Diagrams with 50+ nodes may render slowly. There is an 8-second timeout — overly complex diagrams will show a timeout error. |
| **Diagram type support** | Rendering depends on the bundled Mermaid version. Experimental diagram types may not be available. |

### Tips for Better Diagrams

- **Be specific about diagram type:** "Create a flowchart showing..." or "Make a mindmap of..." gives better results than "visualize this data."
- **Specify structure:** For mindmaps, describe the grouping you want (e.g., "group by status" or "group by team").
- **Colors in flowcharts work:** For flowchart/graph diagrams, you can ask for colors — the AI can use `style` and `classDef` directives that render correctly.
- **Keep it focused:** Diagrams with too many nodes become unreadable. Ask the AI to show top-level categories or limit to a subset.

---

## In-Chat Help

Type `/help` for instant documentation without consuming RAG context:

| Command | Description |
|---|---|
| `/help` | List available help topics |
| `/help <topic>` | Get help on a specific feature |
| `/help page edit` | How Direct Page Edit works |
| `/help agent` | Autonomous agent usage |
| `/help mcp tools` | MCP tool setup |
| `/help settings` | Settings quick reference |

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

**Cause:** LiteLLM proxy isn't running or the endpoint is wrong.
**Fix:** Start your LiteLLM proxy and verify the endpoint in settings.

### Re-Index takes too long

**Cause:** First-time indexing processes your entire graph.
**Fix:** Normal for large graphs. Click "Stop" to pause — progress is saved. Subsequent runs are fast (incremental).

### Chat input unresponsive

**Cause:** Focus was lost after a panel action (rare).
**Fix:** Click directly in the text area to restore focus.

---

## Related Documentation

- [Getting Started](https://github.com/indraginanjar/logseq-mixer/blob/main/docs/user/getting-started.md) — Installation and first-time setup
- [Agentic AI](https://github.com/indraginanjar/logseq-mixer/blob/main/docs/user/agentic-ai.md) — Agent capabilities and memory
- [MCP Tools](https://github.com/indraginanjar/logseq-mixer/blob/main/docs/user/mcp-tools.md) — External tool configuration
