import { MCPClient, MCPTool } from './MCPClient';

export interface MCPServerConfig {
  name: string;
  url?: string;
  command?: string;
  args?: string[];
}

export interface OpenAIFunctionTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: any;
  };
}

export class MCPManager {
  private static instance: MCPManager | null = null;
  private clients = new Map<string, MCPClient>();
  private toolStates: Record<string, boolean> = {}; // key: "serverName:toolName", value: true (enabled) or false (disabled)
  
  // Mapping of generated function names to their corresponding server and tool details
  private functionMapping = new Map<string, { serverName: string; originalToolName: string }>();
  
  public configError: string | null = null;
  private onClientsChangeCallbacks = new Set<() => void>();

  private constructor() {
    this.loadToolStates();
  }

  public static getInstance(): MCPManager {
    if (!MCPManager.instance) {
      MCPManager.instance = new MCPManager();
    }
    return MCPManager.instance;
  }

  public subscribeClientsChange(callback: () => void): () => void {
    this.onClientsChangeCallbacks.add(callback);
    return () => {
      this.onClientsChangeCallbacks.delete(callback);
    };
  }

  private notifyClientsChange() {
    this.onClientsChangeCallbacks.forEach((cb) => cb());
  }

  private loadToolStates() {
    try {
      const stored = localStorage.getItem('logseq-mixer:mcp-tools');
      if (stored) {
        this.toolStates = JSON.parse(stored);
      }
    } catch (err) {
      console.error('[MCPManager] Failed to load tool states:', err);
    }
  }

  private saveToolStates() {
    try {
      localStorage.setItem('logseq-mixer:mcp-tools', JSON.stringify(this.toolStates));
    } catch (err) {
      console.error('[MCPManager] Failed to save tool states:', err);
    }
  }

  public isToolEnabled(serverName: string, toolName: string): boolean {
    const key = `${serverName}:${toolName}`;
    // By default, tools are enabled if they haven't been explicitly disabled
    return this.toolStates[key] !== false;
  }

  public toggleTool(serverName: string, toolName: string, enabled: boolean) {
    const key = `${serverName}:${toolName}`;
    this.toolStates[key] = enabled;
    this.saveToolStates();
    this.notifyClientsChange();
  }

  public getServers(): MCPClient[] {
    return Array.from(this.clients.values());
  }

  public async initialize(): Promise<void> {
    this.syncWithSettings();
  }

  public syncWithSettings() {
    try {
      const mcpSetting = window.logseq.settings?.mcpServers;
      let parsed: any = null;
      this.configError = null;
      if (mcpSetting && typeof mcpSetting === 'string') {
        try {
          parsed = JSON.parse(mcpSetting);
        } catch (e: any) {
          console.warn('[MCPManager] Failed to parse JSON configuration:', e);
          this.configError = e.message || 'Invalid JSON syntax';
        }
      }

      let configs: MCPServerConfig[] = [];

      if (parsed) {
        // If it's the wrapped format: { "mcpServers": { ... } }
        if (parsed.mcpServers && typeof parsed.mcpServers === 'object' && !Array.isArray(parsed.mcpServers)) {
          parsed = parsed.mcpServers;
        }

        if (Array.isArray(parsed)) {
          configs = parsed.map((item: any): MCPServerConfig => ({
            name: String(item.name || ''),
            url: item.url ? String(item.url) : undefined,
            command: item.command ? String(item.command) : undefined,
            args: Array.isArray(item.args) ? item.args.map(String) : undefined,
          })).filter(c => c.name);
        } else if (typeof parsed === 'object') {
          configs = Object.entries(parsed).map(([name, val]: [string, any]): MCPServerConfig | null => {
            if (val && typeof val === 'object') {
              return {
                name,
                url: val.url ? String(val.url) : undefined,
                command: val.command ? String(val.command) : undefined,
                args: Array.isArray(val.args) ? val.args.map(String) : undefined,
              };
            }
            return null;
          }).filter((c): c is MCPServerConfig => c !== null && !!c.name);
        }
      }

      const activeNames = new Set(configs.map((c) => c.name));

      // Disconnect and remove servers no longer in settings
      this.clients.forEach((client, name) => {
        if (!activeNames.has(name)) {
          console.info(`[MCPManager] Removing MCP server: ${name}`);
          client.disconnect();
          this.clients.delete(name);
        }
      });

      // Add or update servers from settings
      configs.forEach((config) => {
        const existing = this.clients.get(config.name);
        const configUrl = config.url || '';
        if (existing) {
          if (existing.url !== configUrl) {
            console.info(`[MCPManager] Updating URL for MCP server ${config.name} to ${configUrl}`);
            existing.disconnect();
            existing.url = configUrl;
            existing.connect().catch((err) => {
              console.error(`[MCPManager] Failed to reconnect to ${config.name}:`, err);
            });
          }
        } else {
          console.info(`[MCPManager] Adding new MCP server ${config.name}`);
          const client = new MCPClient(config.name, config.url);
          client.subscribeStatus(() => this.notifyClientsChange());
          this.clients.set(config.name, client);
          client.connect().catch((err) => {
            console.error(`[MCPManager] Failed to connect to new server ${config.name}:`, err);
          });
        }
      });

      this.notifyClientsChange();
    } catch (err) {
      console.error('[MCPManager] Failed to sync MCP servers settings:', err);
    }
  }

  public shutdown() {
    this.clients.forEach((client) => {
      client.disconnect();
    });
    this.clients.clear();
    this.onClientsChangeCallbacks.clear();
  }

  public reconnectAll() {
    this.clients.forEach((client) => {
      if (client.status === 'error' || client.status === 'disconnected') {
        client.connect().catch((err) => {
          console.error(`[MCPManager] Failed to reconnect ${client.name}:`, err);
        });
      }
    });
  }

  /**
   * Generates a safe name for OpenAI function calling
   */
  private makeFunctionName(serverName: string, toolName: string): string {
    const cleanServer = serverName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const cleanTool = toolName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const fullName = `mcp__${cleanServer}__${cleanTool}`;
    
    // Fallback if name is longer than 64 characters
    if (fullName.length > 64) {
      // Use hash to shorten the name
      let hash = 0;
      const str = `${serverName}__${toolName}`;
      for (let i = 0; i < str.length; i++) {
        hash = (hash << 5) - hash + str.charCodeAt(i);
        hash |= 0;
      }
      const hashStr = Math.abs(hash).toString(36);
      return `mcp__short_${hashStr}__${cleanTool.slice(0, 30)}`;
    }
    return fullName;
  }

  public getEnabledTools(): OpenAIFunctionTool[] {
    const openAiTools: OpenAIFunctionTool[] = [];
    this.functionMapping.clear();

    this.clients.forEach((client, serverName) => {
      if (client.status === 'connected') {
        client.tools.forEach((tool) => {
          if (this.isToolEnabled(serverName, tool.name)) {
            const funcName = this.makeFunctionName(serverName, tool.name);
            this.functionMapping.set(funcName, {
              serverName,
              originalToolName: tool.name,
            });

            openAiTools.push({
              type: 'function',
              function: {
                name: funcName,
                description: tool.description || `Tool from MCP server ${serverName}`,
                parameters: tool.inputSchema || {
                  type: 'object',
                  properties: {},
                },
              },
            });
          }
        });
      }
    });

    return openAiTools;
  }

  public async executeToolCall(functionName: string, args: Record<string, any>): Promise<string> {
    const mapping = this.functionMapping.get(functionName);
    if (!mapping) {
      throw new Error(`Tool call mappings not found for function: ${functionName}`);
    }

    const { serverName, originalToolName } = mapping;
    const client = this.clients.get(serverName);
    if (!client) {
      throw new Error(`MCP Client ${serverName} not found`);
    }

    const result = await client.callTool(originalToolName, args);
    
    // Parse result text out of MCP format
    // MCP tool call returns: { content: Array<{ type: 'text'; text: string } | ...> }
    if (result && Array.isArray(result.content)) {
      const texts = result.content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text);
      return texts.join('\n\n');
    }

    return JSON.stringify(result);
  }
}
