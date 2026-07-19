<p align="center">
  <img src="https://raw.githubusercontent.com/indraginanjar/logseq-mixer/main/logseq.png" alt="Logseq Mixer" width="128" height="128">
</p>

<h1 align="center">Logseq Mixer</h1>

<p align="center">
  <strong>An autonomous AI agent that lives inside your Logseq graph.</strong><br>
  <em>It remembers. It reasons. It acts.</em>
</p>

<p align="center">
  <a href="https://github.com/martindev9999/logseq-composer"><img src="https://img.shields.io/badge/fork--of-logseq--composer-blue?style=flat-square" alt="Fork of Logseq Composer"></a>
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License MIT">
  <img src="https://img.shields.io/badge/LLM_providers-100+-purple?style=flat-square" alt="100+ LLM Providers">
</p>

---

## Why Logseq?

**Logseq changed how we think.** It gave us a frictionless way to capture ideas as they come — no folders, no hierarchy to plan upfront, just write. The outliner structure, bidirectional links, and graph view let knowledge organize itself naturally over time. Daily journals become a habit. Scattered thoughts become connected insights. What used to take deliberate filing systems now happens effortlessly.

Logseq makes you **faster** (capture → link → find in seconds), **more organized** (everything connects without maintenance), and **more productive** (your past notes compound into a knowledge base that grows with you, not against you).

## Why Mixer?

Now imagine your graph has a **collaborator** that reads everything you've written, understands the connections, and actively helps you build on them.

Logseq Mixer takes everything that makes Logseq great and amplifies it:

- **Faster** — Ask a question, get answers synthesized from across hundreds of pages instantly. No more manual searching.
- **More organized** — The agent creates, links, and structures pages for you. Tell it what you want; it handles the block-level details.
- **More productive** — Complex research tasks that took hours of reading and cross-referencing now happen in one conversation. The AI remembers your preferences and context across sessions — it gets better the more you use it.

Logseq gave you a second brain. Mixer gives that brain a voice — and hands.

---

## The problem Mixer solves

You've been writing in Logseq for months — maybe years. Hundreds of pages. Thousands of blocks. Your knowledge is *in there*. But:

> **You know you wrote about it... somewhere.**
> You search. 40 results. You open tabs. You skim. You cross-reference dates. Twenty minutes later, you've pieced together what a single question should have answered.

> **You want to create something from what you already know.**
> A summary. An overview page. A structured collection from scattered notes. But gathering the material, reading it, and organizing it is an hour of manual work.

> **Your graph is growing, but your ability to use it isn't keeping up.**
> The more you write, the harder it becomes to find, connect, and build on what you've already captured. The value is compounding — but you can't access it fast enough.

Mixer exists because your notes deserve better than a search bar.

---

## What changes with Mixer

**Before:** You want to find everything you've noted about a project across 3 months of journals. You open search, try keywords, open a dozen pages, mentally cross-reference them.

**After:** You ask Mixer. It finds 7 relevant blocks across your graph, synthesizes them into a coherent answer, and cites each source with `((block-ref))` links you can click to jump straight there. 8 seconds.

**Before:** You need a structured overview page for a topic scattered across your notes. You spend an hour reading, copy-pasting, reorganizing.

**After:** You tell Mixer: *"Create an overview of my machine learning notes with links to sources."* The agent searches, reads, extracts, creates the page, writes structured content with backlinks. You approve the plan and watch it execute.

**Before:** You ask your AI assistant something about your notes. It gives a generic answer because it can't see your graph.

**After:** Mixer has indexed your entire graph. It retrieves relevant context, understands block hierarchy, resolves references, and answers grounded in *your actual notes* — not hallucinations.

---

## Who uses Mixer?

- **Researchers** cross-referencing papers, literature notes, and experimental observations
- **Developers** maintaining project logs, architecture decisions, and technical knowledge bases
- **Writers** building interconnected worldbuilding, story bibles, or content plans
- **Students** synthesizing lecture notes, readings, and study material before exams
- **Knowledge workers** managing meeting notes, project timelines, and institutional memory

If your graph has more than 50 pages, you're leaving value on the table without Mixer.

---

<p align="center">
  <img src="https://raw.githubusercontent.com/indraginanjar/logseq-mixer/main/docs/assets/demo.gif" alt="Logseq Mixer in action" width="800">
</p>

---

Logseq Mixer isn't a chatbot bolted onto your notes. It's an **autonomous agent** with persistent memory, hybrid RAG retrieval, and direct graph editing — powered by any model from any provider. Give it a goal, and it plans, executes, self-corrects, and learns.

---

## Use any model

Three built-in providers — **no proxy required** for the simplest setups:

| Provider | Setup | Models |
|---|---|---|
| **OpenAI** (direct) | Just add your API key | GPT-4o, GPT-4, GPT-3.5 Turbo, o1, o3, o4-mini |
| **Ollama** (local) | Run Ollama locally — no API key needed | Llama, Mistral, Qwen, any GGUF |
| **LiteLLM** (proxy) | Route through a local proxy to access 100+ providers | Anthropic, Google, DeepSeek, Cohere, Azure, Bedrock... |

**Start in 30 seconds with OpenAI:** Paste your API key, select a model, done.

**Want full privacy?** Use Ollama — everything runs on your machine, no data leaves, no API key required.

**Need Anthropic, Google, or other providers?** Run a [LiteLLM](https://github.com/BerriAI/litellm) proxy to access 100+ providers through a single endpoint. Switch models mid-conversation without changing any plugin settings.

---

## Autonomous agent

> *"What if your AI assistant didn't just answer questions — but actually did the work?"*

Give Mixer a complex objective. It **plans** the steps, **executes** them across your graph, **self-corrects** when results are inadequate, and **remembers** everything for next time.

```
You: "Find all my pages about machine learning, extract key concepts,
      and create a structured overview that links back to sources"

Agent: 🤖 Goal detected. Generating plan...

       ✅ 1. Search for machine learning pages
       ✅ 2. Read content from 7 matched pages
       🔄 3. Extract and categorize key concepts
       ⏳ 4. Create "ML Overview" page
       ⏳ 5. Write structured content with source links

       ████████████░░░░░░ 3/5 steps | 42K/100K tokens
```

**It remembers everything.** Tell it your preferences once — it remembers across sessions. Every conversation is auto-summarized into persistent memory that participates in future RAG retrieval. Your AI gets smarter the more you use it.

**It self-corrects.** After each step, the agent evaluates whether the output *actually achieved the intent* — not just whether the API call succeeded. If quality is lacking, it re-executes with corrective guidance.

**It chains tools iteratively.** Using the ReAct pattern (Reason → Act → Observe), the AI reasons about what it needs, calls tools, observes results, then decides whether to call more tools or answer. This works in *every* conversation — not just agent mode.

**Two autonomy modes:** Plan-first (shows plan for approval) or Autopilot (executes immediately with a Stop button).

> 📖 [Full agent documentation →](https://github.com/indraginanjar/logseq-mixer/blob/main/docs/user/agentic-ai.md)

---

## Understands your notes

Ask about something you wrote months ago. Mixer finds it — even if you don't remember the exact words. It understands meaning, not just keywords.

- **Semantic search** — Finds conceptually related content even when words differ. "What were my concerns about the deadline?" finds blocks that say "timeline is too aggressive."
- **Keyword precision** — Also does exact term matching for code, names, and quoted phrases when that's what you need.
- **Hierarchy-aware** — Respects Logseq's block tree structure. Parent context is preserved, so answers maintain the original nesting and relationships.
- **Clickable citations** — Every answer cites source blocks as `((uuid))` links. Click to navigate directly to the source. Verify, expand, or edit in place.

Under the hood: HNSW-accelerated vector search (sub-5ms across 20,000+ chunks), BM25 keyword index, and Reciprocal Rank Fusion — all running locally in your browser. Nothing leaves your machine unless you choose a cloud embedding provider.

> 📖 [Retrieval pipeline deep-dive →](https://github.com/indraginanjar/logseq-mixer/blob/main/docs/technical/retrieval-pipeline.md)

---

## Edits your graph directly

Toggle **Direct Page Edit** and the AI becomes a co-author. It reads the full block tree of your active page, then inserts, updates, or deletes blocks using Logseq's native API.

- **Insert** — Create nested blocks under any existing block
- **Update** — Rewrite content or properties of existing blocks
- **Delete** — Remove blocks cleanly
- **Change summary** — See exactly what was created or altered after every edit

No copy-paste. No switching contexts. Just tell it what you want, and your page transforms.

---

## Extend with any tool

Mixer supports the **[Model Context Protocol (MCP)](https://modelcontextprotocol.io/)** — connect external tools and the AI uses them autonomously.

```json
{
  "web-search": { "url": "http://localhost:3001/sse" },
  "playwright": { "url": "http://localhost:3002/sse" },
  "filesystem": { "url": "http://localhost:3003/sse" }
}
```

**6 built-in Logseq tools** (search, read, insert, update, delete, create pages) + **unlimited MCP tools** — all chainable in a single query. The AI decides which tools to call, chains them iteratively, and synthesizes the results.

Web search, browser automation, file system access, database queries — anything with an MCP server becomes a capability your AI can use inside your graph.

> 📖 [MCP setup guide →](https://github.com/indraginanjar/logseq-mixer/blob/main/docs/user/mcp-tools.md)

---

## Quick Start

### 1. Install the Mixer

The easiest way — install from the **Logseq Plugin Marketplace**:

1. Open Logseq → Plugins → Marketplace
2. Search for **"Mixer"**
3. Click Install — done.

<details>
<summary><strong>Alternative: Install from source</strong></summary>

```bash
git clone https://github.com/indraginanjar/logseq-mixer.git
cd logseq-mixer
pnpm install && pnpm build && pnpm postbuild
```
Then load as an unpacked plugin in Logseq (Settings → Advanced → Developer Mode → Load unpacked plugin).

</details>

### 2. Choose your AI provider

Open plugin settings and select one:

**Option A — OpenAI (fastest setup):**
1. Set Chat Provider → `openai`
2. Paste your API key
3. Done — uses `https://api.openai.com/v1/chat/completions` by default

**Option B — Ollama (fully local, free):**
1. [Install Ollama](https://ollama.com) and pull a model: `ollama pull llama3.2`
2. Set Chat Provider → `ollama`
3. Endpoint is `http://localhost:11434/api/chat` — no API key needed

**Option C — LiteLLM (100+ providers):**
```bash
pip install litellm
litellm --model gpt-4o --port 4000
```
1. Set Chat Provider → `litellm`
2. Endpoint: `http://127.0.0.1:4000/chat/completions`
3. Configure [any supported provider](https://docs.litellm.ai/docs/providers) behind the proxy

> **Tip:** Any OpenAI-compatible endpoint works with the `openai` provider — just change the endpoint URL. This includes vLLM, LocalAI, text-generation-webui, and many others.

### 3. Index your notes

Click the **Re-Index** button in the chat panel. Mixer will incrementally process your pages — only new or changed content is embedded. Then start chatting.

> 📖 [Full setup guide →](https://github.com/indraginanjar/logseq-mixer/blob/main/docs/user/getting-started.md)

---

## Documentation

### For Users

| Guide | Description |
|---|---|
| [Getting Started](https://github.com/indraginanjar/logseq-mixer/blob/main/docs/user/getting-started.md) | Installation, provider setup, first-time indexing |
| [User Guide](https://github.com/indraginanjar/logseq-mixer/blob/main/docs/user/user-guide.md) | UI walkthrough, settings reference, troubleshooting |
| [Agentic AI](https://github.com/indraginanjar/logseq-mixer/blob/main/docs/user/agentic-ai.md) | Agent capabilities, memory, autonomy modes |
| [MCP Tools](https://github.com/indraginanjar/logseq-mixer/blob/main/docs/user/mcp-tools.md) | External tool setup and configuration |

### For Developers

| Document | Description |
|---|---|
| [Architecture](https://github.com/indraginanjar/logseq-mixer/blob/main/docs/technical/architecture.md) | System overview, module map, data flow |
| [Retrieval Pipeline](https://github.com/indraginanjar/logseq-mixer/blob/main/docs/technical/retrieval-pipeline.md) | Embedding, chunking, hybrid search, HNSW |
| [Agent Internals](https://github.com/indraginanjar/logseq-mixer/blob/main/docs/technical/agent-internals.md) | ReAct loop, goal detection, self-correction |
| [MCP Protocol](https://github.com/indraginanjar/logseq-mixer/blob/main/docs/technical/mcp-protocol.md) | Transport layer, tool calling loop |

---

## Fork Notice & Acknowledgments

<p align="center">
  <a href="https://github.com/martindev9999/logseq-composer"><img src="https://img.shields.io/badge/fork--of-logseq--composer-blue?style=flat-square" alt="Fork of Logseq Composer"></a>
</p>

This project is a fork of **[Logseq Composer](https://github.com/martindev9999/logseq-composer)**, developed by **[Martin Minarik](https://github.com/martindev9999)**. We extend our sincere thanks to Martin for building and open-sourcing the original version of this software. Mixer builds on that foundation with autonomous agent capabilities, hybrid RAG retrieval, persistent memory, and MCP tool integration.
