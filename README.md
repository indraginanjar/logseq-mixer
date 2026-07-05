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

Logseq Mixer isn't a chatbot bolted onto your notes. It's an **autonomous agent** with persistent memory, hybrid RAG retrieval, and direct graph editing — powered by any model from any provider. Give it a goal, and it plans, executes, self-corrects, and learns.

<p align="center">
  <img src="https://raw.githubusercontent.com/indraginanjar/logseq-mixer/main/docs/assets/demo.gif" alt="Logseq Mixer in action" width="800">
</p>

---

## Use any model

One plugin. **Every LLM provider.** Mixer connects through [LiteLLM](https://github.com/BerriAI/litellm) — a unified interface to 100+ providers. Switch models mid-conversation without changing a single setting.

| Provider | Models |
|---|---|
| **OpenAI** | GPT-4o, GPT-4, GPT-3.5 Turbo |
| **Anthropic** | Claude 4 Sonnet, Claude 3.5 Haiku |
| **Google** | Gemini 2.5 Pro, Gemini 2.5 Flash |
| **DeepSeek** | DeepSeek V3, DeepSeek R1 |
| **Local** | Ollama (Llama, Mistral, Qwen, any GGUF) |
| **+ 100 more** | Cohere, Together, Groq, Fireworks, Azure, AWS Bedrock... |

Your data, your model, your infrastructure. Run fully local with Ollama, or use the latest frontier models in the cloud. Mixer doesn't care — it speaks the same language to all of them.

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

Mixer uses a **hybrid RAG pipeline** that actually understands the structure of your knowledge graph — not just flat text search.

- **HNSW-accelerated vector search** — Sub-5ms semantic retrieval across 20,000+ chunks
- **BM25 keyword search** — Precise term matching for code, names, and quoted phrases
- **Reciprocal Rank Fusion** — Merges both result sets with intelligent query-adaptive weighting
- **Hierarchy-aware chunking** — Respects Logseq's block tree structure, preserves parent context across chunk boundaries
- **Clickable block citations** — The AI cites source blocks as `((uuid))` links you can click to navigate directly to the source

Your notes are indexed locally in SQLite (via IndexedDB). Nothing leaves your machine unless you choose a cloud embedding provider. Incremental indexing means only changed pages are re-processed — even massive graphs stay fast.

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

### 1. Start a LiteLLM proxy

```bash
pip install litellm
litellm --model gpt-4o --port 4000
```

This gives you an OpenAI-compatible endpoint at `http://127.0.0.1:4000/chat/completions` that Mixer connects to by default. Configure [any supported provider](https://docs.litellm.ai/docs/providers).

### 2. Install the plugin

**Marketplace:** Install "Logseq Mixer" from the Logseq Plugin Marketplace.

**From source:**
```bash
git clone https://github.com/indraginanjar/logseq-mixer.git
cd logseq-mixer
pnpm install && pnpm build && pnpm postbuild
```
Then load as an unpacked plugin in Logseq (Settings → Advanced → Developer Mode → Load unpacked plugin).

### 3. Index your notes

Click the **Re-Index** button in the chat panel. Mixer will incrementally process your pages — only new or changed content is embedded. Then start chatting.

> 📖 [Full setup guide →](https://github.com/indraginanjar/logseq-mixer/blob/main/docs/user/getting-started.md)

---

## Documentation

### For Users

| Guide | Description |
|---|---|
| [Getting Started](https://github.com/indraginanjar/logseq-mixer/blob/main/docs/user/getting-started.md) | Installation, LiteLLM setup, first-time indexing |
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
