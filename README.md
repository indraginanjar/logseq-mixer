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
</p>

---

**Logseq Mixer** is a highly capable, RAG-powered AI assistant plugin for Logseq. It is a fork of **[Logseq Composer](https://github.com/martindev9999/logseq-composer)** (originally created by **[Martin Minarik](https://github.com/martindev9999)**). 

By combining semantic vector embeddings with keyword search and the Logseq Editor API, Logseq Mixer goes beyond simple chat interfaces: it understands the structure of your notes, retrieves the most relevant context, and can even edit your blocks directly from the chat.

<p align="center">
  <img src="https://raw.githubusercontent.com/indraginanjar/logseq-mixer/main/docs/assets/demo.gif" alt="Logseq Mixer Demo" width="800">
</p>

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

## Model Context Protocol (MCP) Support

Logseq Mixer supports the **[Model Context Protocol (MCP)](https://modelcontextprotocol.io/)**, allowing the AI assistant to dynamically discover and invoke external tools (such as reading local files, querying databases, running web searches, etc.).

### Browser Sandbox & Transport Mode
Because Logseq plugins run inside sandboxed browser iframes, **stdio-based MCP transport is not directly supported** (the browser environment cannot spawn local shell processes). Instead, Mixer connects to MCP servers using **Server-Sent Events (SSE)**.
- **For SSE Servers:** Connect directly using their HTTP/SSE URL (e.g. `http://localhost:3001/sse`).
- **For Stdio-only Servers:** Use a local bridge proxy (such as `supergateway` or `mcp-proxy`) to expose the stdio server as an SSE endpoint. For detailed instructions on setting up and troubleshooting Browser MCP over a bridge, see the [Browser MCP Guide](file:///C:/Users/indra/s/ig/work/indra/logseq-plugin/logseq-composer/docs/browsermcp-guide.md).

#### SSE Bridge Examples (e.g., Playwright MCP Server)
If you want to run the Playwright MCP server (`@playwright/mcp@latest`), which only supports stdio natively, you can expose it as an SSE server using one of the following bridge proxies:

##### Option A: Using `supergateway`
Run the gateway server in your terminal:
```bash
npx -y supergateway --port 3002 --stdio "npx -y @playwright/mcp@latest"
```
Then configure the server URL in your Mixer settings as:
```json
{
  "playwright": {
    "url": "http://localhost:3002/sse"
  }
}
```

##### Option B: Using `mcp-proxy`
Alternatively, run `mcp-proxy` in your terminal:
```bash
npx -y mcp-proxy --port 3002 -- npx -y @playwright/mcp@latest
```
Then configure the server URL in your Mixer settings as:
```json
{
  "playwright": {
    "url": "http://localhost:3002/sse"
  }
}
```

### Configuring MCP Servers
To configure MCP servers, open Logseq Settings → Plugin Settings → **Mixer**, and configure the **`mcpServers`** setting. Mixer supports standard key-value map and wrapped JSON configuration layouts.

Example configuration:
```json
{
  "filesystem-bridge": {
    "url": "http://localhost:3002/sse"
  }
}
```

### Toggling Tools
1. Click the **🔌 MCP Servers** button in the chat box toolbar row to open the MCP Servers Manager.
2. In the panel, you will see all registered servers, their connection status (`online`, `offline`, `connecting`, or `error`), and tool count.
3. Click a server card to expand it and use the toggle switches to enable or disable individual tools. Enabled tools are automatically exposed to the LLM during conversation.

---

## File & Image Attachments

Attach files directly in the chat input to give the LLM additional context or ask questions about their content.

### How to Attach
- **Click the 📎 button** next to the text area to open a file picker. Supports **multiple file selection** (images and text files can be mixed).
- **Paste an image** from clipboard directly into the text area (Ctrl+V). Multiple pastes accumulate.

### Supported File Types

| Type | Behavior |
| :--- | :--- |
| **Images** (PNG, JPG, GIF, etc.) | Displayed as a thumbnail preview. Sent to the LLM as vision content (requires a vision-capable model like GPT-4o). |
| **Text files** (code, CSV, TXT, MD, JSON, etc.) | Content is read as text and appended to your message as context for the LLM. Shown as a `📎 filename` badge in the chat bubble. |

### Re-using Attachments
- **Images:** Click the **📋 Copy Image** button on any image in the chat to copy it to clipboard, then paste it into the input.
- **Files:** Click the **📎 filename** badge on any previous message to re-attach that file for the next query.

### Inserting Images into Logseq Pages
When using AI Edit mode with an attached image, the plugin provides copy-paste instructions instead of writing the image directly into blocks:
1. The image is displayed in the chat with a **"📋 Copy Image"** button.
2. Click the button to copy the image to your clipboard.
3. Click the target block in Logseq and press **Ctrl+V**.
4. Logseq's native paste handler saves the image to the `assets/` folder and inserts a proper `![](../assets/...)` reference.

### Limitations
- **No direct asset writing:** Logseq's plugin API does not expose a method to write files to the graph's `assets/` folder. Images must be pasted manually into blocks using Logseq's native paste mechanism.
- **Clipboard from iframe:** The plugin runs in a sandboxed iframe. Programmatic clipboard writes only work via a direct user click (the "📋 Copy Image" button). Right-click → "Copy Image" on data-URI images may not work in all environments.
- **Large images as base64:** Images are sent to the LLM as base64 data URIs. Very large images increase token usage and may slow down responses.
- **Text-only file reading:** Non-image files are read as plain text. Binary files (PDF, DOCX, ZIP, etc.) will produce garbled content — only use text-based file formats.
- **Vision model required:** Image understanding requires a vision-capable model (e.g., GPT-4o, Claude 3.5 Sonnet). Non-vision models will ignore the image content.

---

## Technical Documentation

For details on the internals and design choices behind the plugin, check the technical specification files:

- [Embedding Strategy](https://github.com/indraginanjar/logseq-mixer/blob/dev/docs/embedding-strategy.md) — Chunking mechanisms, vector generation, and performance optimization.
- [Chunking Strategy](https://github.com/indraginanjar/logseq-mixer/blob/dev/docs/chunking-strategy.md) — Block boundaries, parent-child block structures, and context preservation.
- [Retrieval Strategy](https://github.com/indraginanjar/logseq-mixer/blob/dev/docs/retrieval-strategy.md) — Hybrid search (SQLite + BM25), reranking logic, and LiteLLM prompting.
- [MCP Server Integration](https://github.com/indraginanjar/logseq-mixer/blob/dev/docs/mcp-integration.md) — EventSource/SSE transport layer, MCPManager lifecycle sync, and agentic tool-calling loop execution.
- [Browser MCP Guide](https://github.com/indraginanjar/logseq-mixer/blob/dev/docs/browsermcp-guide.md) — Step-by-step setup, Windows port 9009 bug workaround, and multiple browser connection conflict resolutions.

---

## Fork Notice & Acknowledgments

This project is a fork of **[Logseq Composer](https://github.com/martindev9999/logseq-composer)**, developed by **[Martin Minarik](https://github.com/martindev9999)**. We want to extend our sincere thanks to Martin for building and open-sourcing the original version of this software.
