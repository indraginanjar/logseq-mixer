# Getting Started

Get Logseq Mixer running in under 5 minutes. By the end of this guide, you'll have an AI agent that understands your entire knowledge graph.

---

## Prerequisites

- **Logseq** desktop app (latest version recommended)
- **Node.js 18+** (only needed if building from source)
- **Python 3.8+** (only if using the LiteLLM proxy)

---

## Step 1: Start a LiteLLM Proxy

Mixer communicates with LLMs through [LiteLLM](https://github.com/BerriAI/litellm) — a lightweight local proxy that provides an OpenAI-compatible API for 100+ providers. This means you can use *any* model without changing plugin code.

### Install LiteLLM

```bash
pip install litellm
```

### Start the proxy

Choose your provider:

**OpenAI:**
```bash
export OPENAI_API_KEY="sk-..."
litellm --model gpt-4o --port 4000
```

**Anthropic:**
```bash
export ANTHROPIC_API_KEY="sk-ant-..."
litellm --model claude-sonnet-4-20250514 --port 4000
```

**Google Gemini:**
```bash
export GEMINI_API_KEY="..."
litellm --model gemini/gemini-2.5-pro --port 4000
```

**DeepSeek:**
```bash
export DEEPSEEK_API_KEY="..."
litellm --model deepseek/deepseek-chat --port 4000
```

**Local (Ollama):**
```bash
# First, start Ollama with a model
ollama run llama3.1

# Then point LiteLLM at it
litellm --model ollama/llama3.1 --port 4000
```

**Multiple models (config file):**
```yaml
# litellm_config.yaml
model_list:
  - model_name: gpt-4o
    litellm_params:
      model: openai/gpt-4o
      api_key: sk-...
  - model_name: claude-sonnet
    litellm_params:
      model: anthropic/claude-sonnet-4-20250514
      api_key: sk-ant-...
  - model_name: llama-local
    litellm_params:
      model: ollama/llama3.1
```

```bash
litellm --config litellm_config.yaml --port 4000
```

Once running, you'll have an endpoint at `http://127.0.0.1:4000/chat/completions`. This is what Mixer connects to by default.

> 📖 Full provider list: [docs.litellm.ai/docs/providers](https://docs.litellm.ai/docs/providers)

---

## Step 2: Install the Plugin

### Option A: Logseq Marketplace (Recommended)

1. Open Logseq
2. Go to **Settings → Plugins → Marketplace**
3. Search for **"Logseq Mixer"**
4. Click **Install**

### Option B: From Source

```bash
git clone https://github.com/indraginanjar/logseq-mixer.git
cd logseq-mixer
pnpm install
pnpm build
pnpm postbuild
```

Then in Logseq:
1. Go to **Settings → Advanced → Developer Mode** (enable it)
2. Click **Load unpacked plugin**
3. Select the `logseq-mixer` project root (or the `dist` folder)

---

## Step 3: Configure Settings

Open **Settings → Plugin Settings → Mixer** and configure:

| Setting | Value | Notes |
|---|---|---|
| **Selected Model** | `gpt-4o` | Must match a model name in your LiteLLM config |
| **API Key** | Your provider's API key | e.g., `sk-...` for OpenAI |
| **LiteLLM api link** | `http://127.0.0.1:4000/chat/completions` | Default — change if your proxy uses a different port |

### Embedding Settings (for RAG search)

| Setting | Value | Notes |
|---|---|---|
| **Embedding Provider** | `openai` or `ollama` | Choose based on your preference |
| **Embedding Model** | `text-embedding-3-small` | Good balance of quality and cost |
| **Embedding API Endpoint** | `https://api.openai.com/v1/embeddings` | Or `http://localhost:11434/api/embeddings` for Ollama |
| **Embedding AI ApiKey** | Your OpenAI key | Not needed for Ollama |

> **Fully local setup:** Use `ollama` as embedding provider with `nomic-embed-text` model + Ollama as the LLM via LiteLLM. Zero data leaves your machine.

---

## Step 4: Index Your Notes

1. Click the **Mixer** toolbar icon to open the chat panel
2. Click the **Re-Index** button (bottom-right of the toolbar)
3. Wait for indexing to complete — only new/changed pages are processed

The first index takes longer (it processes your entire graph). Subsequent runs are incremental — typically a few seconds. Deleted pages are automatically detected and purged from the index.

**What gets indexed:**
- All your pages (including journal entries)
- Block content with full parent hierarchy preserved
- Block references and embeds resolved to actual content

**What's skipped:**
- Internal Logseq pages (cards, contents, favorites)
- Pages starting with `__`

---

## Step 5: Verify It Works

Type a question about your notes in the chat panel:

```
What are my notes about [topic]?
```

If Mixer returns relevant content with `((block-uuid))` citations you can click — you're all set.

---

## Next Steps

- **Enable Direct Page Edit** — Toggle ✏️ to let the AI modify your current page directly
- **Enable the Agent** — Toggle 🤖 for autonomous multi-step task execution
- **Add MCP tools** — Connect web search, browser control, or file system access

> 📖 [User Guide →](https://github.com/indraginanjar/logseq-mixer/blob/main/docs/user/user-guide.md) — Full UI walkthrough and settings reference
>
> 📖 [Agentic AI →](https://github.com/indraginanjar/logseq-mixer/blob/main/docs/user/agentic-ai.md) — Agent capabilities and memory system
>
> 📖 [MCP Tools →](https://github.com/indraginanjar/logseq-mixer/blob/main/docs/user/mcp-tools.md) — External tool setup

---

## Troubleshooting First-Time Setup

### Models not showing in dropdown

**Cause:** The configured provider isn't reachable or the endpoint is wrong.

**Fix:** Check that your provider is running and the endpoint in settings is correct. The model dropdown fetches from whichever provider is configured: OpenAI (`/v1/models`), Ollama (`/api/tags`), or LiteLLM (`/models`).

### Re-Index takes very long

**Cause:** First-time indexing processes your entire graph.

**Fix:** This is normal. You can click "Stop" to pause — already-indexed pages are saved. Resume later by clicking Re-Index again (only remaining pages will be processed).

### "No results" when chatting

**Cause:** Indexing hasn't completed, or the embedding settings are misconfigured.

**Fix:** 
1. Check that Re-Index completed (the button should say "Re-Index", not "Stop")
2. Verify your embedding endpoint is reachable (try opening it in a browser)
3. For Ollama embeddings, ensure `ollama` is running with the embedding model pulled: `ollama pull nomic-embed-text`
