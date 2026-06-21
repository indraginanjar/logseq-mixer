<p align="center">
  <img src="https://raw.githubusercontent.com/indraginanjar/logseq-mixer/dev/logseq.png" alt="Logseq Mixer Logo" width="128" height="128">
</p>

<h1 align="center">Logseq Mixer</h1>

<p align="center">
  <strong>Connect your Logseq notes with any LLM using local/cloud vector embeddings, Hybrid RAG, and direct AI-powered block editing.</strong>
</p>

<p align="center">
  <a href="https://github.com/martindev9999/logseq-composer"><img src="https://img.shields.io/badge/fork--of-logseq--composer-blue?style=flat-square" alt="Fork of Logseq Composer"></a>
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License MIT">
  <a href="https://buymeacoffee.com/martinminarik"><img src="https://img.shields.io/badge/sponsor-buy%20me%20a%20coffee-yellow?style=flat-square" alt="Sponsor Original Author"></a>
</p>

---

**Logseq Mixer** is a highly capable, RAG-powered AI assistant plugin for Logseq. It is a fork of **[Logseq Composer](https://github.com/martindev9999/logseq-composer)** (originally created by **[Martin Minarik](https://github.com/martindev9999)**). 

By combining semantic vector embeddings with keyword search and the Logseq Editor API, Logseq Mixer goes beyond simple chat interfaces: it understands the structure of your notes, retrieves the most relevant context, and can even edit your blocks directly from the chat.

**[Watch the Demo Video](https://www.youtube.com/watch?v=J0QDrz-Ccis)**

> [!IMPORTANT]
> **Database Indexing Required:** For the LLM to access your files, you need to trigger a database index scan (using the green **Re-Index** button at the bottom-left of the chat panel). By default, Mixer uses **Incremental Indexing**, meaning only new or updated pages are processed—making it fast even for massive vaults.
>
> If you are upgrading from an older version that didn't support clickable block references, a **Full Re-Index** is required to populate block metadata and associate block UUID annotations with your text chunks.

---

## Key Features

- **SQLite Vector Storage (IndexedDB):** Stores document embeddings in a robust, local SQLite database (powered by [sql.js](https://github.com/sql-js/sql.js)) running in IndexedDB, scaling efficiently to large knowledge graphs.
- **Advanced Hybrid RAG:** Matches your queries using a state-of-the-art hybrid pipeline combining HNSW-accelerated vector search, BM25 keyword search, and Reciprocal Rank Fusion (RRF) reranking.
- **AI Edit Mode:** Let the LLM insert, update, or delete blocks directly on your active page. When toggled, the LLM receives the active page's block tree structure and emits actions executed via the Logseq Editor API.
- **Inline References & Links:**
  - **Clickable block references:** The LLM cites source blocks using standard `((uuid))` notation, rendered as clickable teal-colored inline links.
  - **Clickable page links:** References to pages in `[[double brackets]]` are styled as blue links that open target pages on click.
- **Multi-Provider Support:** Supports any model compatible with **[LiteLLM](https://github.com/BerriAI/litellm)** (OpenAI, Anthropic Claude, Google Gemini, DeepSeek, local Ollama, etc.).
- **Background Auto-Indexing:** Detects workspace changes and automatically re-indexes changed pages in the background after a customizable debounce period.
- **Stop & Cooldown Controls:** Halt indexing at any point. The Re-Index button transforms into a "Stop" button during active runs, initiating a short cooldown to let the editor settle.

---

## Installation & Setup

### 1. Prerequisites (Run LiteLLM Proxy)
Logseq Mixer communicates with your models using a running **[LiteLLM](https://github.com/BerriAI/litellm)** proxy server. LiteLLM is a lightweight, local proxy that offers an OpenAI-compatible interface for over 100+ LLM providers.

To set up the proxy:
```bash
# Install LiteLLM via pip
pip install litellm

# Start the proxy (example using GPT-4o)
litellm --model gpt-4o --port 4000
```
This starts the proxy server at `http://127.0.0.1:4000/chat/completions`, which is the default endpoint Mixer looks for. You can configure any [LiteLLM-supported provider or model](https://docs.litellm.ai/docs/providers).

### 2. Install the Plugin
#### Option A: Marketplace
Install **Logseq Mixer** directly from the built-in Logseq Plugin Marketplace (once approved).

#### Option B: Manual Installation (From Source)
If you want to run the latest development build:
1. Clone this repository:
   ```bash
   git clone https://github.com/martindev9999/logseq-composer.git logseq-mixer
   cd logseq-mixer
   ```
2. Install dependencies and build the plugin:
   ```bash
   # Using pnpm
   pnpm install
   pnpm run build
   pnpm run postbuild
   
   # Or using yarn
   yarn install
   yarn run build
   yarn run postbuild
   ```
3. Open Logseq, enable **Developer Mode** in Settings > Advanced.
4. Click `Load unpacked plugin`, navigate to the `logseq-mixer` directory, and select the `dist` directory or the project root.

---

## Configuration Settings

Configure these settings inside the Logseq Plugin settings page:

| Setting Key | Type | Default Value | Description |
| :--- | :--- | :--- | :--- |
| **`selectedModel`** | String | `"gpt-4o"` | The name of the LLM model to use (passed directly to LiteLLM). |
| **`apiKey`** | Password | *None* | The API key used to authenticate with your LLM provider. |
| **`LiteLLMLink`** | String | `http://127.0.0.1:4000/chat/completions` | The local or hosted LiteLLM completion server endpoint. |
| **`prompt`** | Text | *Default System Prompt* | The system prompt template sent to the LLM. The string `"context"` is replaced by the retrieved notes. |
| **`embeddingProvider`** | Enum | `"openai"` | Choose between `"openai"` (cloud-based) or `"ollama"` (local embeddings). |
| **`EmbeddingApiKey`** | Password | *None* | API Key for generating OpenAI embeddings. Not required if using Ollama. |
| **`embeddingModel`** | Enum | `"text-embedding-3-small"` | Model used for vector embeddings. Choices: OpenAI (`text-embedding-3-small`, `text-embedding-ada-002`, `text-embedding-3-large`) or Ollama (`nomic-embed-text`, `mxbai-embed-large`, `all-minilm`). Changing this triggers a full vector database rebuild. |
| **`embeddingEndpoint`** | String | `https://api.openai.com/v1/embeddings` | The API endpoint for generating embeddings. For local Ollama, set to `http://localhost:11434/api/embeddings`. |
| **`indexingMode`** | Enum | `"incremental"` | **`incremental`** only updates changed pages. **`full`** rebuilds the entire database from scratch. *(Note: Switch back to incremental after running a full index to avoid wasting API credits).* |
| **`storageBackend`** | Enum | `"sqlite"` | **`sqlite`** uses local SQLite database (IndexedDB). **`settings`** is the legacy Orama-based storage (recommended for small graphs only). |
| **`autoEmbedEnabled`** | Boolean | `true` | When true, page modifications trigger background embedding generation. |
| **`autoIndexDebounceSeconds`** | Number | `300` | Delay in seconds to wait after your last edit before background auto-indexing kicks in. |

---

## AI Edit Mode

Toggle the **AI Edit** switch in the chat panel's toolbar to allow the LLM to directly write to and modify your open page.

1. **Hierarchy Context:** Mixer compiles the active page's blocks, attributes, and block UUIDs, passing them to the LLM.
2. **Structured Actions:** The LLM responds with structured edits specifying the targets of its actions.
3. **Execution:** The plugin runs the edits using Logseq's native API:
   - **Insert:** Add a nested block under any block UUID.
   - **Update:** Edit the text or properties of an existing block.
   - **Delete:** Safely remove blocks.
4. **Summary:** A change summary is displayed showing exactly what blocks were created or altered.

---

## Technical Documentation

For details on the internals and design choices behind the plugin, check the technical specification files:

- [Embedding Strategy](https://github.com/indraginanjar/logseq-mixer/blob/dev/docs/embedding-strategy.md) — Chunking mechanisms, vector generation, and performance optimization.
- [Chunking Strategy](https://github.com/indraginanjar/logseq-mixer/blob/dev/docs/chunking-strategy.md) — Block boundaries, parent-child block structures, and context preservation.
- [Retrieval Strategy](https://github.com/indraginanjar/logseq-mixer/blob/dev/docs/retrieval-strategy.md) — Hybrid search (SQLite + BM25), reranking logic, and LiteLLM prompting.

---

## Fork Notice & Acknowledgments

This project is a fork of **[Logseq Composer](https://github.com/martindev9999/logseq-composer)**, developed by **[Martin Minarik](https://github.com/martindev9999)**. We want to extend our sincere thanks to Martin for building and open-sourcing the original version of this software.

If you enjoy this plugin and want to support the original creator's efforts, please consider buying him a coffee:

<p align="left">
  <a href="https://buymeacoffee.com/martinminarik" target="_blank">
    <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" style="height: 50px !important; width: 178px !important;" >
  </a>
</p>
