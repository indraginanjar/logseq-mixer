# Browser MCP Configuration & Troubleshooting Guide

This guide explains how to configure, run, and troubleshoot **Browser MCP** (`@browsermcp/mcp`) with Logseq Mixer. Browser MCP allows the AI assistant to interact directly with your open, logged-in browser sessions.

---

## Architectural Constraint: SSE Bridge

Because Logseq plugins run inside sandboxed browser iframes, they cannot execute local commands directly. You must run a local bridge proxy (like `supergateway`) to translate the stdio connection of the Browser MCP server into a Server-Sent Events (SSE) stream.

---

## Step-by-Step Setup

1. **Start the SSE Bridge**:
   Run the following command in your terminal to start the bridge proxy on port `3003` wrapping Browser MCP:
   ```bash
   npx -y supergateway --port 3003 --stdio "npx -y @browsermcp/mcp@latest"
   ```

2. **Configure Logseq Mixer**:
   In Logseq, open **Settings** -> **Plugin Settings** -> **Mixer**, and paste the following in the **`mcpServers`** configuration:
   ```json
   {
     "browsermcp-bridge": {
       "url": "http://localhost:3003/sse"
     }
   }
   ```

3. **Install and Connect the Chrome/Edge Extension**:
   - Install the **BrowserMCP Extension** from the Chrome Web Store on your browser (Chrome or Edge).
   - Ensure the browser is open and click the extension icon to click **Connect**.
   - Open the Logseq Mixer chat window, click **🔌 MCP Servers**, expand `browsermcp-bridge`, and toggle on the browser tools you want to use.

---

## Troubleshooting Common Errors

### 1. Connecting Multiple Browsers Simultaneously (Chrome + Edge Connection Conflict)
If you install the BrowserMCP extension on both Chrome and Edge, and click **Connect** on both browsers at the same time, the tool calls will fail or one of the browsers will show connection errors.
- **Why this happens:** The `@browsermcp/mcp` server starts a WebSocket listener on a single local port (`9009`). It expects a **single active browser connection** at any given time. Connecting a second browser will either refuse the connection or conflict with the existing session.
- **Solution:** Only connect **one browser extension at a time**. Disconnect the extension in one browser before clicking **Connect** in the other.

### 2. `Failed to kill process on port 9009` (Windows Startup Crash)
This is a known bug in the `@browsermcp/mcp` script on Windows. The script queries port `9009` and attempts to kill any active process using it. However, because `netstat` returns multiple lines (for IPv4 and IPv6), the script tries to kill the same PID twice. On the second iteration, `taskkill` fails with "process not found" (exit code 128) and crashes Node.js.
- **Solution:** Create a temporary file named `taskkill.bat` in your current terminal working directory before running the command:
  ```batch
  @echo off
  C:\Windows\System32\taskkill.exe %*
  exit /b 0
  ```
  This batch file intercepts `taskkill` and forces it to return exit code `0` (success). Once the `supergateway` server starts successfully, you can delete the `taskkill.bat` file.

### 3. `listen EADDRINUSE: address already in use :::3003`
This error occurs if you try to start a new `supergateway` server on a port that is already in use by another running bridge process.
- **Solution:** Either close the other bridge process (by pressing `Ctrl + C` in its terminal) or specify a different port (e.g. `--port 3004`) to run them concurrently.

### 4. `connect ECONNREFUSED 127.0.0.1:8082` or `TypeError: fetch failed`
This error indicates that the BrowserMCP server is running, but it cannot connect to the browser extension.
- **Solution:** Ensure your browser is open, the BrowserMCP extension is installed, and you have clicked the **Connect** button in the extension popup. If it still refuses to connect, check your browser's extension developer console for any local WebSocket blockages.
