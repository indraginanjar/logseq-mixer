# Agentic AI

Logseq Mixer isn't a chatbot. It's an autonomous agent that plans, executes, self-corrects, and remembers — transforming complex instructions into completed work across your entire knowledge graph.

---

## What the Agent Does

Give Mixer a complex objective, and it:

1. **Detects** that your request requires multiple steps
2. **Plans** a structured sequence of actions
3. **Executes** each step using your graph's full capabilities
4. **Self-corrects** when output quality is inadequate
5. **Replans** dynamically when it discovers new information
6. **Remembers** the outcome for future reference

```
You: "Find all my pages about machine learning, extract the key
      concepts from each one, and create a structured overview page
      that links back to the sources"

Agent: 🤖 Goal detected. Generating plan...

       ✅ 1. Search for machine learning pages
       ✅ 2. Gather all ML pages and extract key concepts (12 pages, 4 batches)
       🔄 3. Synthesize into structured overview with categories
       ⏳ 4. Create "ML Overview" page with source links

       ████████████░░░░░░ 3/4 steps | 52K/100K tokens
```

---

## Examples of What It Can Do

**Knowledge synthesis:**
> "Find all my project pages, extract open TODOs, and create a priority-ranked task list"

**Content creation:**
> "Research my notes on distributed systems and write a blog post draft with citations"

**Graph organization:**
> "Find duplicate concepts across my graph and consolidate them into canonical pages"

**Multi-tool workflows (with MCP):**
> "Search the web for recent developments in RAG, then create a notes page with what you find"

**What stays as normal chat (not goal-detected):**
> "What is X?" / "Explain how Y works" / "Summarize this page"

---

## Persistent Memory

The AI remembers things across sessions — your preferences, past conversations, and task outcomes.

### How Memories Are Created

| Trigger | Example | What's stored |
|---|---|---|
| **Explicit** | "Remember that I prefer concise bullet points" | Preference memory |
| **Implicit** | Say anything with "todo" or "deadline" | Task memory |
| **Automatic** | Click "✨ New" to start a new session | Session summary |
| **Agent completion** | Agent finishes a multi-step goal | Task outcome |

### How They're Used

Every time you send a message, relevant memories are injected into the AI's context:
- **Preferences** are always included (they shape response style)
- **Session summaries** provide continuity across conversations
- **Facts and tasks** are keyword-matched to your current query

The result: your AI gets better the more you use it.

### Managing Memories

Click **🧠** in the toolbar to open the Memory Manager:

- **Filter** by category (All, Preferences, Facts, Sessions, Tasks)
- **Edit** a memory by clicking ✏️
- **Delete** individual memories with 🗑️
- **Clear All** to reset (with confirmation)

### Memory Pages in Your Graph

Memories are also written to Logseq pages under `Mixer/Memory/`:
```
Mixer/Memory/
├── Session-2026-06-29-1200     (conversation summaries)
├── Session-2026-06-29-1430
├── Preferences                  (your stated preferences)
└── Facts                        (stored facts)
```

These pages participate in RAG — so your AI can retrieve its own memories through the normal search pipeline.

---

## Goal Detection

The agent activates when your message looks like a multi-step task rather than a simple question.

**Primary method:** The plugin sends a classification prompt to the LLM asking whether the user's message represents a multi-step goal. This provides nuanced understanding of intent. If the LLM classification is unavailable or fails, regex-based heuristics are used as a fallback.

**Filtering:** Single-step write/edit requests (e.g., "write a block", "add a note", "insert a TODO") are filtered out — they go to Direct Page Edit instead of the agent, even if they match goal patterns.

### What triggers goal detection:

- **Action verbs:** "organize", "restructure", "consolidate", "create X from Y", "find all X and Y"
- **Multi-step indicators:** "then", "after that", "next", "finally", "and also"
- **Long messages** (>150 characters)
- **Multiple conjunctions** ("and", "then", commas chaining actions)

### What doesn't trigger it:

- Questions starting with "what", "who", "how", "explain"
- Messages ending with `?`
- Short messages (<100 characters)

### Tuning Sensitivity

Adjust `Agent Confidence Threshold` in settings:
- **0.4** — Aggressive: triggers on most multi-clause requests
- **0.6** — Balanced (default): clear goals only
- **0.8** — Conservative: only obvious complex tasks

---

## Autonomy Modes

### Plan-First (Default)

The agent shows you the plan before executing:

```
┌─────────────────────────────────────────────────┐
│ 🤖 Goal: Organize project pages by status       │
├─────────────────────────────────────────────────┤
│ ⏳ 1. Search for all project pages              │
│ ⏳ 2. Read and categorize by status             │
│ ⏳ 3. Create "Projects by Status" overview      │
│ ⏳ 4. Write categorized content with links      │
├─────────────────────────────────────────────────┤
│ [▶️ Approve]  [✕ Cancel]                        │
└─────────────────────────────────────────────────┘
```

You review the plan, then click **Approve** to start execution or **Cancel** to abort.

### Autopilot

The agent executes immediately without waiting for approval. You keep a **⏹ Stop** button to halt at any time.

> **When to use autopilot:** Routine tasks where you trust the agent's judgment. Switch back to plan-first for anything sensitive.

---

## Self-Correction

After each step, the agent doesn't just check "did the API call succeed?" — it evaluates whether the output **actually achieved the intent**.

```
Step: "Extract key concepts from ML pages"
Output: [list of page names only]

Agent evaluation: ❌ "Listed pages but didn't extract concepts"
↩️ Re-executing with corrective guidance...

Output: [structured concept list with explanations]
Agent evaluation: ✅ Adequate
```

If the output is inadequate, the agent:
1. Identifies what's wrong
2. Generates corrective guidance
3. Re-executes the step with that guidance as context
4. Re-evaluates (up to the retry limit)

---

## Dynamic Replanning

Every 2 completed steps, the agent reviews progress against the original goal:

> *"Given what I've learned so far, does the remaining plan still make sense?"*

If it discovers something unexpected (e.g., the data is structured differently than expected), it can propose a modified plan:

- **Plan-first mode:** Shows the proposed changes for your approval
- **Autopilot mode:** Auto-approves and continues

---

## Large-Scale Data Gathering (Map-Reduce)

When your goal involves processing many pages — say, "summarize all my notes on distributed systems" — the agent uses a **Map-Reduce pattern** to handle data that would otherwise exceed the LLM's context window.

### How It Works

Instead of trying to read 20 pages at once (which would be truncated and lose information), the agent:

1. **Search** — Finds all relevant pages
2. **Gather (Map)** — Reads pages in small batches (3 at a time), summarizing each batch with the LLM's full attention
3. **Think (Reduce)** — Synthesizes all batch summaries into the final deliverable

```
You: "Find all my pages about project management and create
      a consolidated best practices guide"

Agent:
  ✅ 1. [search] Find project management pages → 12 pages found
  🔄 2. [gather] Read and extract best practices from all 12 pages
       ├─ Batch 1/4: PM Basics, Sprint Planning, Retrospectives → summarized
       ├─ Batch 2/4: Risk Management, Stakeholders, Agile → summarized
       ├─ Batch 3/4: Kanban, Estimation, Velocity → summarized
       └─ Batch 4/4: Team Dynamics, Communication, Prioritization → summarized
  ⏳ 3. [think] Synthesize into structured best practices guide
  ⏳ 4. [write] Create "PM Best Practices" page
```

### Why This Matters

- **No data loss** — Each batch of 3 pages gets the LLM's full attention for extraction
- **Unlimited scale** — Whether you have 5 pages or 50, the agent processes them all
- **Quality over quantity** — Focused summarization per batch produces higher quality than cramming everything into one prompt
- **Working memory** — Gathered data is stored in a scratch pad that isn't subject to the normal truncation limits between steps

### When It Activates

The planner automatically uses `gather` steps when it detects:
- Goals involving "all pages about X"
- Requests to "summarize", "consolidate", or "extract from" multiple sources
- Any task where more than 3 pages need to be read and processed

You don't need to do anything special — the agent chooses the right strategy automatically.

---

## ReAct Tool Chaining

Even outside of agent mode, the AI uses **iterative tool chaining** in every conversation. When answering a question that requires multiple lookups:

```
Think: "I need to find the user's project pages first"
Act:   logseq_search_pages("project") → Found: Alpha, Beta, Gamma
Think: "Let me read Project Alpha to check its structure"
Act:   logseq_get_blocks("Project Alpha") → [block tree with TODOs]
Think: "Now I have enough context to answer"
Answer: [comprehensive response with cross-project insights]
```

The AI chains up to 25 tool calls per query (configurable), reasoning between each one about whether it needs more information.

### Available Built-in Tools

| Tool | Capability |
|---|---|
| `logseq_search_pages` | Find pages by name |
| `logseq_get_page` | Get page metadata |
| `logseq_get_blocks` | Read a page's block tree |
| `logseq_insert_block` | Create new blocks |
| `logseq_update_block` | Modify existing blocks |
| `logseq_create_page` | Create new pages |

> **Note:** Write tools (insert, update, create page) are only available when Direct Page Edit (✏️) is ON. Read-only tools (search, get page, get blocks) are always available.

Plus any [MCP tools](https://github.com/indraginanjar/logseq-mixer/blob/main/docs/user/mcp-tools.md) you connect — web search, file system, browser automation, databases, etc.

---

## Safety Controls

| Control | How it works |
|---|---|
| **Token budget** | Hard limit per goal (default 100K tokens). Budget bar turns amber at 80%, stops at 100%. |
| **Plan approval** | See the full plan before anything executes (plan-first mode). |
| **Stop button** | Halt execution instantly at any point. |
| **Escalation** | When stuck, the agent asks YOU for guidance via an inline text field — it never guesses on critical decisions. |
| **Replan approval** | If the agent wants to change the plan mid-execution, it asks first. |
| **Retry limits** | Max retries per step (default 2) before escalating. |

---

## Configuration

| Setting | Default | Description |
|---|---|---|
| **Agent Mode** | `true` | Enable autonomous goal detection and multi-step execution |
| **Agent Confidence Threshold** | `0.6` | Minimum confidence to trigger the agent (0.0-1.0) |
| **Agent Autonomy Level** | `plan-first` | `plan-first` shows plan for approval; `autopilot` executes immediately |
| **Agent Token Budget** | `100000` | Maximum tokens per autonomous run (0 = unlimited) |
| **Agent Max Retries** | `2` | Retry attempts per failed step before escalation |
| **Agent Max Tool Iterations** | `25` | Maximum ReAct loop iterations per query |
| **Agent Verbose Mode** | `true` | Show detailed step outputs and self-correction in progress UI |
| **Persist Agent Steps to Chat** | `false` | Stream each step as a chat message |
| **Agent Fast Model** | _(empty)_ | Lightweight model for extraction steps (e.g., `gpt-4o-mini`) |
| **Agent Memory** | `true` | Allow agent to recall and store observations across runs |

---

## Progress UI

When the agent is running, you'll see a live progress panel:

```
┌─────────────────────────────────────────────────┐
│ 🤖 Goal: Find all project pages and summarize  │
├─────────────────────────────────────────────────┤
│ ✅ 1. Search for project management pages       │
│ ✅ 2. Read content from matched pages           │
│    └─ Found 3 pages with relevant content       │
│ 🔄 3. Analyze and extract key points            │
│ ⏳ 4. Create summary page                       │
├─────────────────────────────────────────────────┤
│ ████████████░░░░ 3/4 steps                      │
│ ██████░░░░░░░░░░ 45K/100K tokens                │
├─────────────────────────────────────────────────┤
│ [⏹ Stop]                                        │
└─────────────────────────────────────────────────┘
```

**Step states:** ⏳ pending → 🔄 running → ✅ done / ❌ failed / ⏭️ skipped

**On failure:** "↻ Retry" and "⏭ Skip" buttons appear.

**Verbose mode (default ON):** Shows color-coded step type badges (`read`, `write`, `search`, `tool`, `think`, `gather`, `specialist`), per-step token usage, ↩ correction badges with reasoning, and detailed error messages for failed steps. Toggle it on/off directly from the chat toolbar using the 📋 button — no need to open settings.

---

## Context Quality Management

Mixer uses two techniques to ensure high-quality output even on complex, multi-step goals:

### Automatic Context Compression

As the agent executes steps, it accumulates outputs from each step. If this accumulated context grows too large, the agent automatically compresses it into a focused "working memory" — preserving all factual data (page names, UUIDs, search results) while removing redundancy and verbosity.

**You won't see this happen** — it's automatic and transparent. The effect is that later steps (especially the final synthesis) receive cleaner, more focused context and produce better results.

### Specialist Steps

For tasks that require high-quality synthesis or complex analysis, the agent uses **specialist steps** — isolated sub-tasks that receive only the specific data they need, rather than everything that happened before.

Example: if you ask "Compare my React and Vue notes and create a comparison table," the agent might:
1. 🔍 Search for React pages
2. 📥 Gather data from React pages
3. 🔍 Search for Vue pages
4. 📥 Gather data from Vue pages
5. 🎯 **Specialist**: Create comparison table (receives *only* the gathered data from steps 2 and 4)

The specialist step produces higher-quality output because it's not distracted by search results, intermediate reasoning, or other noise — it sees only the relevant extracted data.

---

## Sub-Agent Capabilities

Mixer's agent can now decompose complex goals into independent sub-tasks, execute them in parallel, and use different models for different phases — all automatically.

### Sub-Goals (Recursive Decomposition)

When a goal is too complex for a linear plan, the agent can spawn **sub-agents** — independent child agents that plan and execute autonomously:

```
You: "Compare my notes about React, Vue, and Angular, and create
      a recommendation page based on my project requirements"

Agent: 🤖 Plan generated:
       1. Search for framework-related pages
       2. 🔀 Sub-goal: "Analyze React notes" (independent agent)
       3. 🔀 Sub-goal: "Analyze Vue notes" (independent agent)
       4. 🔀 Sub-goal: "Analyze Angular notes" (independent agent)
       5. Specialist: Compare and synthesize recommendation
       6. Write recommendation page
```

Each sub-goal gets its own plan, executes independently, and returns its synthesis to the parent. Sub-goals:
- Have **read-only access** by default (can't modify your graph)
- Share the parent's **token budget** (can't blow the limit)
- Respect the **Stop button** (abort propagates to all children)
- Are limited to **2 levels deep** (prevents infinite recursion)

### Specialists with Tool Access

Specialist steps can now **search and read pages autonomously** during their execution:

```
You: "Create a detailed comparison of my project management approaches"

Agent: ... → Specialist step: "Research and compare PM approaches"
       Specialist uses tools:
         🔧 logseq_search_pages("project management")
         🔧 logseq_get_blocks("Agile Notes")
         🔧 logseq_get_blocks("Waterfall Process")
         → Produces comprehensive comparison
```

Previously, specialists could only reason about data already gathered. Now they can independently fetch what they need.

### Parallel Execution

When steps don't depend on each other, the agent executes them **simultaneously**:

```
🤖 Executing Wave 1: (3 steps in parallel)
   ✅ Search for React pages        [0.8s]
   ✅ Search for Vue pages           [0.7s]
   ✅ Search for Angular pages       [0.9s]

🤖 Executing Wave 2: (3 steps in parallel)
   ✅ Gather React concepts          [3.2s]
   ✅ Gather Vue concepts            [2.8s]
   ✅ Gather Angular concepts        [3.1s]

🤖 Executing Wave 3:
   ✅ Synthesize comparison          [2.5s]

Total: 7.4s (vs ~15s sequential)
```

Parallel execution activates automatically when the planner identifies independent steps.

### Model Routing

Configure a **fast model** for extraction tasks to reduce cost while maintaining quality for synthesis:

| Setting | Default | What it does |
|---|---|---|
| **Agent Fast Model** | _(empty)_ | Lightweight model for gather/read steps (e.g., `gpt-4o-mini`) |

When set, the agent automatically routes:
- **Gather & Read steps** → Fast model (cheaper, still accurate for extraction)
- **Think, Specialist, Write steps** → Main model (full reasoning power)

Leave empty to use your main model for everything.

### Agent Memory

The agent now **remembers observations** across runs:

**First run:**
> "Summarize my machine learning notes"
>
> Agent searches, gathers 7 pages, synthesizes summary.
> 💾 Stores: *"User has ML notes across 7 pages: Neural Nets, Supervised Learning, ..."*

**Second run:**
> "What else do I know about neural networks?"
>
> Agent recalls: *"User has ML notes across 7 pages: Neural Nets, ..."*
> → Immediately searches the right pages without trial-and-error.

Agent memory is **on by default** and works alongside your existing Mixer memories. Toggle it off in settings if you prefer each run to start fresh.

---

## Agent Settings Reference

| Setting | Default | Description |
|---|---|---|
| **Agent Mode** | `true` | Enable autonomous goal detection and multi-step execution |
| **Agent Confidence Threshold** | `0.6` | Minimum confidence to trigger the agent (0.0-1.0) |
| **Agent Autonomy Level** | `plan-first` | `plan-first` shows plan for approval; `autopilot` executes immediately |
| **Agent Token Budget** | `100000` | Maximum tokens per autonomous run (0 = unlimited) |
| **Agent Max Retries** | `2` | Retry attempts per failed step before escalation |
| **Agent Max Tool Iterations** | `25` | Maximum ReAct loop iterations per query |
| **Agent Verbose Mode** | `true` | Show detailed step outputs and self-correction in progress UI |
| **Persist Agent Steps to Chat** | `false` | Stream each step as a chat message |
| **Agent Fast Model** | _(empty)_ | Lightweight model for extraction steps (e.g., `gpt-4o-mini`) |
| **Agent Memory** | `true` | Allow agent to recall and store observations across runs |

---

## Related Documentation

- [User Guide](https://github.com/indraginanjar/logseq-mixer/blob/main/docs/user/user-guide.md) — Full UI walkthrough and settings
- [MCP Tools](https://github.com/indraginanjar/logseq-mixer/blob/main/docs/user/mcp-tools.md) — Extend the agent with external capabilities
- [Agent Internals](https://github.com/indraginanjar/logseq-mixer/blob/main/docs/technical/agent-internals.md) — Technical deep-dive into the implementation
