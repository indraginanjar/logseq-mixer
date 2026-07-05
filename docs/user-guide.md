# Logseq Mixer — User Guide

A practical guide to using the Logseq Mixer chat interface and configuring its settings.

---

## Chat Window Overview

When you click the Mixer toolbar icon in Logseq, the chat panel opens. Here's what everything does:

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
| **Model Selector** | Dropdown to switch between LLM models. Fetches available models from your LiteLLM server automatically. |
| **✨ New** | Start a new chat session. Clears all messages and resets conversation context. If auto-summarize is enabled, saves a summary of the current session to memory before clearing. |
| **✕** | Close the chat panel. |

---

## Toggles (Left Side of Toolbar)

| Toggle | Icon | What it does |
|---|---|---|
| **Auto-Embed** | 📇 | When ON, the plugin automatically generates embeddings for pages you edit (after a debounce delay). When OFF, you must manually re-index. |
| **AI Edit** | ✏️ | When ON, the AI can directly create pages, insert blocks, update blocks, and delete blocks in your graph. When OFF, the AI only provides text responses in the chat — no graph modifications. |
| **Agent** | 🤖 | When ON, complex multi-step requests are detected and handled by the autonomous agent (with planning, execution, self-correction). When OFF, all messages go through the normal single-turn chat. |

**Tip:** Hover over any toggle to see its tooltip name.

---

## Action Buttons (Right Side of Toolbar)

| Button | What it does |
|---|---|
| **🗄️** | Opens the **Database Center** panel — shows index stats (pages, chunks, DB size), and provides Export, Import, and Clear Database actions. |
| **🔌** | Opens the **MCP Servers** panel — manage connections to external tool servers (web search, file system, browser control, etc.). |
| **🧠** | Opens the **Memory Manager** panel — view, edit, and delete stored memories. Shows a count badge when memories exist. |
| **Re-Index** | Triggers incremental re-indexing of your graph. Only processes new/changed pages. Transforms into a Stop button while indexing is active. |

---

## Input Area

| Element | What it does |
|---|---|
| **📎 Button** | Attach files (text, code, CSV) or images to your message. Multiple files supported. |
| **Text Area** | Type your message. Press Enter to send, Shift+Enter for new line. Arrow Up recalls previous messages. |
| **Send ▶** | Send the message. Transforms into a Cancel button while the AI is responding. |
| **Page/Block Indicator** | Shows the currently active page (📄) and focused block (▸). This is the context the AI sees when AI Edit is enabled. |

---

## Understanding the Indicators

### 💭 Thinking Indicator
When the AI is calling tools iteratively (ReAct loop), you'll see a brief "💭 ..." message showing what it's reasoning about. This disappears when the response arrives.

### ⏳ Summarizing Indicator
Appears briefly next to the 🧠 button when a session is being auto-summarized in the background after you click "New."

### 💾 Remembered
Flashes briefly when the AI stores an explicit memory (triggered by phrases like "remember this:").

---

## How AI Edit Works

1. Toggle ✏️ ON
2. Click into the block/page you want the AI to edit
3. Confirm the page/block indicator shows the correct target
4. Type your instruction (e.g., "add a summary section" or "reorganize these bullets by priority")
5. The AI sends structured edit commands that are executed via Logseq's API
6. A change summary appears showing what was created/modified

**Important:** The AI can only edit the page/block shown in the indicator. If you're on the journal home view, click into a specific block first.

---

## How the Agent Works

When the 🤖 toggle is ON and you give a complex, multi-step instruction:

1. The AI detects it as a "goal" (multi-step task)
2. A plan appears with numbered steps
3. **Plan-first mode** (default): You see the plan and click "▶️ Approve" to start
4. **Autopilot mode**: Execution starts immediately
5. Steps show live status: ⏳ pending → 🔄 running → ✅ done / ❌ failed / ⏭️ skipped
6. Click on step outputs to expand/collapse full details
7. If a step fails: "↻ Retry" and "⏭ Skip" buttons appear
8. Token budget bar shows usage — turns amber at 80%, stops at 100%

**Examples of goals the agent handles:**
- "Find all my pages about X and create a summary page"
- "Organize my TODO items into a priority list"
- "Research topic X using web search and write notes about it" (requires MCP web search tool)

**Examples that stay as normal chat:**
- "What is X?" (question)
- "Explain how Y works" (simple request)
- "Hi there" (greeting)

---

## Memory System

The AI remembers things across sessions:

### Storing Memories
- **Explicit:** Say "Remember this: I prefer concise bullet points" → stored immediately
- **Automatic:** When you click "✨ New", the conversation is summarized and stored

### Memory Categories
| Category | How it's triggered | Example |
|---|---|---|
| Preference | Words like "prefer", "always", "never", "style" | "I prefer markdown tables" |
| Task | Words like "todo", "deadline", "need to" | "Finish report by Friday" |
| Fact | Default for anything else | "Project uses React 17" |
| Session Summary | Automatic on new session | "Discussed chunking strategies..." |

### Managing Memories
Click 🧠 to open the Memory Manager:
- **Filter** by category using the tab pills (All, Preferences, Facts, Sessions, Tasks)
- **Edit** a memory by clicking ✏️ on its card
- **Delete** a memory by clicking 🗑️ (with inline confirmation)
- **Clear All** removes everything (with confirmation)

---

## MCP Tools (External Capabilities)

MCP (Model Context Protocol) lets the AI use external tools like web search, file reading, or browser control.

### Setup
1. Run an MCP server locally (e.g., Playwright for browser control):
   ```bash
   npx -y supergateway --port 3002 --stdio "npx -y @playwright/mcp@latest"
   ```
2. Open Logseq Settings → Plugin Settings → Mixer
3. Set `mcpServers` to:
   ```json
   {
     "playwright": {
       "url": "http://localhost:3002/sse"
     }
   }
   ```
4. Click 🔌 in the chat to verify connection status

### Using Tools
Once connected, the AI automatically uses available tools when needed. You don't need to tell it to "use Playwright" — just ask naturally:
- "Navigate to google.com and search for X" (uses browser tool)
- "Read the file at /path/to/file.txt" (uses filesystem tool)

---

## File & Image Attachments

| Action | How |
|---|---|
| Attach files | Click 📎, select one or more files |
| Paste image | Ctrl+V with an image in clipboard |
| Re-attach from history | Click the 📎 badge on a previous message |
| Copy image from chat | Click "📋 Copy Image" on any image in chat |

**Supported:** Images (PNG, JPG, GIF), text files (code, CSV, TXT, MD, JSON)
**Not supported:** Binary files (PDF, DOCX, ZIP)

---

## Charts & Visuals

The AI can generate visual content directly in chat:

- **Mermaid diagrams** — pie charts, flowcharts, sequence diagrams, gantt charts
- **SVG graphics** — custom illustrations, logos, diagrams

Charts render visually with:
- **📄 SVG** button — copy the source code
- **🖼️ PNG** button — copy as an image (for pasting into documents)

---

## Settings Reference

Open Logseq Settings → Plugin Settings → Mixer.

### LLM Connection

| Setting | What to set | Example |
|---|---|---|
| **Selected Model** | Model name passed to LiteLLM | `gpt-4o` |
| **API Key** | Your LLM provider API key | `sk-proj-...` |
| **LiteLLM api link** | Your LiteLLM proxy endpoint | `http://127.0.0.1:4000/chat/completions` |
| **AI prompt** | System prompt template | (leave default unless customizing) |

### Embedding (for RAG search)

| Setting | What to set | Example |
|---|---|---|
| **Embedding Provider** | `openai`, `ollama`, or `litellm` | `litellm` |
| **Embedding AI ApiKey** | API key for embeddings | (same as above, or separate) |
| **Embedding Model** | Model for generating embeddings | `text-embedding-3-small` |
| **Embedding API Endpoint** | Endpoint URL | OpenAI: `https://api.openai.com/v1/embeddings`<br>Ollama: `http://localhost:11434/api/embeddings`<br>LiteLLM: `http://127.0.0.1:4000/embeddings` |

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
| **Memory Token Budget (%)** | `10` | How much context window to allocate for memories |

### Agent

| Setting | Default | Description |
|---|---|---|
| **Agent Mode** | `on` | Enable/disable autonomous goal pursuit |
| **Agent Autonomy Level** | `plan-first` | `plan-first` = shows plan for approval; `autopilot` = executes immediately |
| **Agent Confidence Threshold** | `0.6` | How aggressively goals are detected (lower = more triggers) |
| **Agent Token Budget** | `100000` | Max tokens per autonomous run (prevents runaway costs) |
| **Agent Max Tool Iterations** | `25` | Max ReAct tool-call iterations per query |
| **Agent Max Retries Per Step** | `2` | Retry attempts before asking for help |
| **Agent Verbose Mode** | `false` | Show self-correction reasoning in progress UI |

### MCP Servers

| Setting | Format | Example |
|---|---|---|
| **MCP Servers Configuration** | JSON object | `{"server-name": {"url": "http://localhost:3002/sse"}}` |

---

## Troubleshooting

### "No active page" warning
**Cause:** You're on the journal home view without clicking into a block.
**Fix:** Click into any block, then the page/block indicator will show the target.

### AI Edit doesn't do anything
**Cause:** The ✏️ toggle might be OFF, or the AI couldn't determine what to edit.
**Fix:** Ensure ✏️ is ON, confirm the page indicator shows the correct page, and be specific in your instruction.

### Agent detects goals too aggressively
**Cause:** Confidence threshold is too low.
**Fix:** Increase `Agent Confidence Threshold` in settings (try 0.8), or toggle 🤖 OFF for simple conversations.

### Agent never activates
**Cause:** The 🤖 toggle is OFF, or your messages are too short/question-like.
**Fix:** Toggle 🤖 ON. For complex tasks, phrase as instructions not questions: "Find all X and create Y" instead of "Can you find X?"

### Chat input unresponsive after panel action
**Cause:** Focus was lost (rare edge case).
**Fix:** Click directly in the text area to restore focus.

### Re-Index takes too long
**Cause:** Large graph with many pages being embedded for the first time.
**Fix:** This is normal for first-time indexing. Subsequent runs only process changed pages. You can click "Stop" to pause and resume later.

### Models not showing in dropdown
**Cause:** LiteLLM proxy isn't running or the endpoint is wrong.
**Fix:** Start your LiteLLM proxy (`litellm --model gpt-4o --port 4000`) and verify the endpoint in settings.

---

## In-Chat Help

Type `/help` in the chat to get help about Logseq Mixer without leaving the conversation.

| Command | What it does |
|---|---|
| `/help` | Shows available help topics |
| `/help <topic>` | Answers a specific question about Mixer |
| `/?` | Same as `/help` |

**Examples:**
- `/help ai edit` — how to use AI Edit mode
- `/help agent` — how the autonomous agent works
- `/help mcp tools` — how to set up external tools
- `/help settings` — quick settings reference
- `/help how do I attach files?` — ask in natural language

Help responses use the built-in documentation — they don't consume your RAG context or search your notes.

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| **Enter** | Send message |
| **Shift+Enter** | New line in message |
| **Arrow Up** | Recall previous message |
| **Ctrl+V** | Paste image from clipboard |
| **Escape** | Close Memory/MCP/Database panels |
