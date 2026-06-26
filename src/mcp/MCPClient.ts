export interface MCPTool {
  name: string;
  description?: string;
  inputSchema?: {
    type: 'object';
    properties?: Record<string, any>;
    required?: string[];
    [key: string]: any;
  };
}

export type MCPClientStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export class MCPClient {
  public name: string;
  public url: string;
  public status: MCPClientStatus = 'disconnected';
  public tools: MCPTool[] = [];
  public errorMessage: string | null = null;

  private eventSource: EventSource | null = null;
  private postEndpoint: string | null = null;
  private nextRequestId = 1;
  private pendingRequests = new Map<
    string | number,
    { resolve: (val: any) => void; reject: (err: any) => void; timeoutId: number }
  >();

  private onStatusChangeCallbacks = new Set<(status: MCPClientStatus) => void>();

  constructor(name: string, url: string) {
    this.name = name;
    this.url = url;
  }

  public subscribeStatus(callback: (status: MCPClientStatus) => void): () => void {
    this.onStatusChangeCallbacks.add(callback);
    return () => {
      this.onStatusChangeCallbacks.delete(callback);
    };
  }

  private setStatus(status: MCPClientStatus, errorMsg: string | null = null) {
    this.status = status;
    this.errorMessage = errorMsg;
    this.onStatusChangeCallbacks.forEach((cb) => cb(status));
  }

  public async connect(): Promise<void> {
    if (this.status === 'connected' || this.status === 'connecting') return;

    this.setStatus('connecting');
    try {
      this.eventSource = new EventSource(this.url);

      this.eventSource.onerror = (e) => {
        console.error(`[MCPClient ${this.name}] SSE connection error:`, e);
        this.setStatus('error', 'SSE connection failed');
        this.disconnect();
      };

      this.eventSource.addEventListener('endpoint', (e: any) => {
        const rawEndpoint = e.data;
        try {
          let resolvedUrl = rawEndpoint;
          if (!rawEndpoint.startsWith('http://') && !rawEndpoint.startsWith('https://')) {
            const baseUrl = new URL(this.url);
            resolvedUrl = new URL(rawEndpoint, baseUrl.origin).toString();
          }
          this.postEndpoint = resolvedUrl;
          console.info(`[MCPClient ${this.name}] POST message endpoint resolved to: ${this.postEndpoint}`);
          this.setStatus('connected');
          this.fetchTools().catch((err) => {
            console.error(`[MCPClient ${this.name}] Failed to fetch tools:`, err);
          });
        } catch (err: any) {
          console.error(`[MCPClient ${this.name}] Failed resolving message endpoint:`, err);
          this.setStatus('error', `Failed resolving endpoint: ${err.message}`);
        }
      });

      this.eventSource.addEventListener('message', (e: any) => {
        this.handleSSEMessage(e.data);
      });
    } catch (err: any) {
      this.setStatus('error', `Connection init failed: ${err.message}`);
      throw err;
    }
  }

  public disconnect(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.postEndpoint = null;
    this.tools = [];
    
    // Reject any remaining pending requests
    this.pendingRequests.forEach((req) => {
      clearTimeout(req.timeoutId);
      req.reject(new Error('Disconnected from server'));
    });
    this.pendingRequests.clear();

    if (this.status !== 'error') {
      this.setStatus('disconnected');
    }
  }

  private handleSSEMessage(rawMessage: string) {
    try {
      const payload = JSON.parse(rawMessage);
      
      // JSON-RPC response handling
      if (payload.id !== undefined && payload.id !== null) {
        const pending = this.pendingRequests.get(payload.id);
        if (pending) {
          this.pendingRequests.delete(payload.id);
          clearTimeout(pending.timeoutId);
          if (payload.error) {
            pending.reject(new Error(payload.error.message || `JSON-RPC Error ${payload.error.code}`));
          } else {
            pending.resolve(payload.result);
          }
        }
      }
    } catch (err) {
      console.error(`[MCPClient ${this.name}] Failed to parse SSE message payload:`, err);
    }
  }

  private async sendRequest(method: string, params: any = {}): Promise<any> {
    if (this.status !== 'connected' || !this.postEndpoint) {
      throw new Error(`MCP Client ${this.name} is not connected.`);
    }

    const id = this.nextRequestId++;
    const jsonRpcRequest = {
      jsonrpc: '2.0',
      method,
      params,
      id,
    };

    return new Promise<any>(async (resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request timed out (${method})`));
        }
      }, 15000) as unknown as number;

      this.pendingRequests.set(id, { resolve, reject, timeoutId });

      try {
        const response = await fetch(this.postEndpoint!, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(jsonRpcRequest),
        });

        if (!response.ok) {
          throw new Error(`HTTP Error ${response.status}: ${response.statusText}`);
        }

        // Try to read the response. If the response contains the JSON-RPC response directly, resolve it
        const responseText = await response.text();
        if (responseText && responseText.trim()) {
          try {
            const body = JSON.parse(responseText);
            if (body && body.id === id) {
              this.pendingRequests.delete(id);
              clearTimeout(timeoutId);
              if (body.error) {
                reject(new Error(body.error.message || `JSON-RPC Error ${body.error.code}`));
              } else {
                resolve(body.result);
              }
            }
          } catch {
            // Not JSON or does not match id; fallback to waiting for the response from SSE
          }
        }
      } catch (err: any) {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          clearTimeout(timeoutId);
          reject(err);
        }
      }
    });
  }

  public async fetchTools(): Promise<MCPTool[]> {
    try {
      const result = await this.sendRequest('tools/list');
      if (result && Array.isArray(result.tools)) {
        this.tools = result.tools;
        console.info(`[MCPClient ${this.name}] Successfully fetched ${this.tools.length} tools`);
      } else {
        this.tools = [];
      }
      return this.tools;
    } catch (err) {
      console.error(`[MCPClient ${this.name}] Error listing tools:`, err);
      throw err;
    }
  }

  public async callTool(toolName: string, args: Record<string, any> = {}): Promise<any> {
    try {
      const result = await this.sendRequest('tools/call', {
        name: toolName,
        arguments: args,
      });
      return result;
    } catch (err) {
      console.error(`[MCPClient ${this.name}] Error calling tool ${toolName}:`, err);
      throw err;
    }
  }
}
