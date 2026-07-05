# MCP Tools

The **[Model Context Protocol (MCP)](https://modelcontextprotocol.io/)** lets you extend Mixer with external tools — web search, browser automation, file system access, database queries, and anything else with an MCP server. The AI discovers available tools automatically and uses them when needed.

---

## How It Works

Connect MCP servers → Mixer discovers their tools → The AI uses them autonomously when relevant.

You don't need to tell the AI "use the web search tool." Just ask naturally:
- "Search the web for recent RAG developments" → uses web search
- "Navigate to that URL and extract the pricing table" → uses browser automation
- "Read the file at /path/to/config.yaml" → uses file system

The AI decides which tools to call, chains them iteratively via [ReAct](https://github.com/indraginanjar/logseq-mixer/blob/main/docs/user/agentic-ai.md), and synthesizes the results.

---

## Why SSE (Server-Sent Events)

Logseq plugins run inside sandboxed browser iframes — they cannot spawn local processes directly. This means **stdio-based MCP transport doesn't work** from within the plugin.

Instead, Mixer connects to MCP servers using **HTTP/SSE**. For servers that only support stdio (which is most of them), you run a lightweight **bridge proxy** locally that exposes the stdio server as an SSE endpoint.

---

## Setup

### Step 1: Start a Bridge Proxy

Choose either `supergateway` or `mcp-proxy`:

**Using supergateway (recommended):**
```bash
npx -y supergateway --port 3002 --stdio "npx -y @playwright/mcp@latest"
```

**Using mcp-proxy:**

macOS / Linux:
```bash
npx -y mcp-proxy --port 3002 -- npx -y @playwright/mcp@latest
```

Windows:
```bash
npx -y mcp-proxy --port 3002 -- cmd /c npx -y @playwright/mcp@latest
```

> **Why `cmd /c` on Windows?** Node.js on Windows can't spawn `.cmd` batch scripts directly. The `cmd /c` wrapper resolves this.

### Step 2: Configure in Logseq

Open **Settings → Plugin Settings → Mixer** and set `mcpServers`:

```json
{
  "playwright": {
    "url": "http://localhost:3002/sse"
  }
}
```

### Step 3: Verify Connection

1. Open the Mixer chat panel
2. Click **🔌 MCP Servers**
3. The server should show as **connected** (green)
4. Expand it to see available tools and toggle them on/off

---

## Configuration Formats

Mixer supports multiple JSON formats for compatibility with other MCP clients.

### Format A: Key-Value Map (Recommended)

```json
{
  "web-search": {
    "url": "http://localhost:3001/sse"
  },
  "playwright": {
    "url": "http://localhost:3002/sse"
  },
  "filesystem": {
    "url": "http://localhost:3003/sse"
  }
}
```

### Format B: Wrapped Object

Allows pasting a full config file (e.g., from Claude Desktop):

```json
{
  "mcpServers": {
    "web-search": {
      "url": "http://localhost:3001/sse"
    }
  }
}
```

### Stdio Entries (Not Directly Supported)

If a server entry has `command` instead of `url`, Mixer shows an error status with guidance to use an SSE bridge:

```json
{
  "git-tool": {
    "command": "npx",
    "args": ["@modelcontextprotocol/server-git"]
  }
}
```
→ Status: ❌ "Stdio servers not supported in browser. Use an SSE bridge proxy."

---

## Popular Server Examples

### Web Search

```bash
npx -y supergateway --port 3001 --stdio "npx -y @anthropic/mcp-server-web-search"
```
```json
{ "web-search": { "url": "http://localhost:3001/sse" } }
```

### Browser Automation (Playwright)

```bash
npx -y supergateway --port 3002 --stdio "npx -y @playwright/mcp@latest"
```
```json
{ "playwright": { "url": "http://localhost:3002/sse" } }
```

### File System

```bash
npx -y supergateway --port 3003 --stdio "npx -y @anthropic/mcp-server-filesystem /path/to/allowed/dir"
```
```json
{ "filesystem": { "url": "http://localhost:3003/sse" } }
```

### Browser MCP (Direct Browser Control)

Controls your actual open browser session (Chrome/Edge) via the BrowserMCP extension:

```bash
npx -y supergateway --port 3004 --stdio "npx -y @browsermcp/mcp@latest"
```
```json
{ "browsermcp": { "url": "http://localhost:3004/sse" } }
```

**Additional setup required:**
1. Install the **BrowserMCP Extension** from the Chrome Web Store
2. Open your browser and click the extension icon → **Connect**
3. Only connect **one browser at a time** (Chrome OR Edge, not both)

---

## Managing Tools

### Toggling Individual Tools

1. Click **🔌** in the chat toolbar
2. Expand a connected server
3. Toggle individual tools on/off

Disabled tools won't be offered to the AI. Useful for limiting scope or reducing tool noise.

### Tool Preferences

Your enable/disable preferences are persisted in browser localStorage. They survive page reloads and plugin restarts.

---

## Troubleshooting

### `Failed to kill process on port 9009` (Windows — Browser MCP)

**Cause:** A known bug in `@browsermcp/mcp` on Windows. The startup script tries to kill a process twice and crashes.

**Workaround:** Create a `taskkill.bat` file in your terminal's working directory:
```batch
@echo off
C:\Windows\System32\taskkill.exe %*
exit /b 0
```

This forces a success exit code. Delete the file once the server starts.

### `listen EADDRINUSE: address already in use :::3002`

**Cause:** Another bridge process is already using that port.

**Fix:** Either stop the other process (Ctrl+C) or use a different port:
```bash
npx -y supergateway --port 3005 --stdio "..."
```

### `connect ECONNREFUSED 127.0.0.1:9009` (Browser MCP)

**Cause:** The BrowserMCP extension isn't connected.

**Fix:** Open your browser, click the BrowserMCP extension icon, and click **Connect**.

### Multiple browser conflict (Browser MCP)

**Cause:** BrowserMCP uses a single WebSocket port (9009). Connecting Chrome AND Edge simultaneously causes conflicts.

**Fix:** Only connect one browser's extension at a time. Disconnect one before connecting the other.

### Server shows "connecting" indefinitely

**Cause:** The SSE endpoint isn't responding.

**Fix:**
1. Verify the bridge proxy is running (check your terminal)
2. Try opening the SSE URL in a browser (e.g., `http://localhost:3002/sse`) — you should see an EventSource connection
3. Check firewall settings aren't blocking localhost

### Tools don't appear after connecting

**Cause:** The MCP server hasn't sent its tool list yet.

**Fix:** Click the server card to collapse/expand it, or reconnect by toggling the server URL in settings.

---

## How Tool Calling Works

When you send a message:

1. Mixer collects all enabled tools from connected MCP servers
2. Tools are sent alongside your message to the LLM
3. If the LLM decides to use a tool, Mixer:
   - Executes the tool call via the MCP server
   - Shows the result to the LLM
   - The LLM decides whether to call more tools or respond
4. This loop repeats (up to 25 iterations) until the LLM has enough information

This is the same [ReAct pattern](https://github.com/indraginanjar/logseq-mixer/blob/main/docs/user/agentic-ai.md) used for the built-in Logseq tools — MCP tools and Logseq tools are fully interleaved and chainable.

---

## Related Documentation

- [Agentic AI](https://github.com/indraginanjar/logseq-mixer/blob/main/docs/user/agentic-ai.md) — How the agent uses tools autonomously
- [MCP Protocol Internals](https://github.com/indraginanjar/logseq-mixer/blob/main/docs/technical/mcp-protocol.md) — Technical deep-dive into the implementation
