import { SettingSchemaDesc } from '@logseq/libs/dist/LSPlugin';

const settings: SettingSchemaDesc[] = [
  // ═══════════════════════════════════════════════════════════════════
  // CHAT PROVIDER
  // ═══════════════════════════════════════════════════════════════════
  {
    key: 'chatProvider',
    type: 'enum',
    title: 'Chat Provider',
    description: 'Choose OpenAI for direct API access, Ollama for local models, or LiteLLM to route through a local proxy to 100+ providers.',
    default: 'openai',
    enumChoices: ['openai', 'ollama', 'litellm'],
    enumPicker: 'select',
  },
  {
    key: 'selectedModel',
    type: 'string',
    title: 'Selected Model',
    description: 'The model name to use (passed directly to the provider). Examples: gpt-4o, claude-3-5-sonnet, deepseek-chat, gemini-pro, llama3.2.',
    default: 'gpt-4o',
  },
  {
    key: 'openaiApiKey',
    type: 'string',
    title: 'OpenAI API Key',
    description: 'API key for OpenAI provider (or any OpenAI-compatible API).',
    default: '',
  },
  {
    key: 'ollamaApiKey',
    type: 'string',
    title: 'Ollama API Key',
    description: 'API key for Ollama provider. Usually not needed for local Ollama.',
    default: '',
  },
  {
    key: 'litellmApiKey',
    type: 'string',
    title: 'LiteLLM API Key',
    description: 'API key for LiteLLM proxy. Pass-through to the underlying provider configured in LiteLLM.',
    default: '',
  },
  {
    key: 'openaiEndpoint',
    type: 'string',
    title: 'OpenAI Endpoint',
    description: 'Chat completions endpoint for OpenAI provider. Leave empty for default (https://api.openai.com/v1/chat/completions). Also works for any OpenAI-compatible API (vLLM, LocalAI, etc.)',
    default: '',
  },
  {
    key: 'ollamaEndpoint',
    type: 'string',
    title: 'Ollama Endpoint',
    description: 'Chat endpoint for Ollama provider. Leave empty for default (http://localhost:11434/api/chat).',
    default: '',
  },
  {
    key: 'litellmEndpoint',
    type: 'string',
    title: 'LiteLLM Endpoint',
    description: 'Chat completions endpoint for LiteLLM proxy. Leave empty for default (http://127.0.0.1:4000/chat/completions).',
    default: '',
  },
  {
    key: 'reasoningEffort',
    type: 'enum',
    title: 'Reasoning Effort',
    description: 'Controls how much thinking the model does before responding. Higher levels produce deeper reasoning but cost more tokens. Low=fastest/cheapest, High=default, Max=deepest reasoning.',
    default: 'high',
    enumChoices: ['low', 'medium', 'high', 'xhigh', 'max'],
    enumPicker: 'select',
  },
  {
    key: 'streamingEnabled',
    type: 'boolean',
    title: 'Streaming Responses',
    description: 'When enabled, AI responses are streamed token-by-token as they are generated, appearing progressively in the chat. Disable if you prefer responses to appear all at once, or if your provider has issues with streaming.',
    default: true,
  },

  // ═══════════════════════════════════════════════════════════════════
  // EMBEDDING PROVIDER
  // ═══════════════════════════════════════════════════════════════════
  {
    key: 'embeddingProvider',
    type: 'enum',
    title: 'Embedding Provider',
    description: 'Choose OpenAI for cloud-based embeddings, Ollama for local embeddings, or LiteLLM to route through your LiteLLM proxy.',
    default: 'openai',
    enumChoices: ['openai', 'ollama', 'litellm'],
    enumPicker: 'select',
  },
  {
    key: 'embeddingModel',
    type: 'enum',
    title: 'Embedding Model',
    description: 'Choose the embedding model. Changing this will re-create the vector database.',
    default: 'text-embedding-3-small',
    enumChoices: [
      'text-embedding-ada-002', 'text-embedding-3-small', 'text-embedding-3-large',
      'nomic-embed-text', 'mxbai-embed-large', 'all-minilm'
    ],
    enumPicker: 'select',
  },
  {
    key: 'openaiEmbeddingApiKey',
    type: 'string',
    title: 'OpenAI Embedding API Key',
    description: 'API key for OpenAI embedding models. Leave empty to use the main OpenAI API key.',
    default: '',
  },
  {
    key: 'ollamaEmbeddingApiKey',
    type: 'string',
    title: 'Ollama Embedding API Key',
    description: 'API key for Ollama embedding provider. Usually not needed for local Ollama.',
    default: '',
  },
  {
    key: 'litellmEmbeddingApiKey',
    type: 'string',
    title: 'LiteLLM Embedding API Key',
    description: 'API key for LiteLLM embedding proxy.',
    default: '',
  },
  {
    key: 'openaiEmbeddingEndpoint',
    type: 'string',
    title: 'OpenAI Embedding Endpoint',
    description: 'Embedding endpoint for OpenAI provider. Leave empty for default (https://api.openai.com/v1/embeddings).',
    default: '',
  },
  {
    key: 'ollamaEmbeddingEndpoint',
    type: 'string',
    title: 'Ollama Embedding Endpoint',
    description: 'Embedding endpoint for Ollama provider. Leave empty for default (http://localhost:11434/api/embeddings).',
    default: '',
  },
  {
    key: 'litellmEmbeddingEndpoint',
    type: 'string',
    title: 'LiteLLM Embedding Endpoint',
    description: 'Embedding endpoint for LiteLLM proxy. Leave empty for default (http://127.0.0.1:4000/embeddings).',
    default: '',
  },

  // ═══════════════════════════════════════════════════════════════════
  // INDEXING
  // ═══════════════════════════════════════════════════════════════════
  {
    key: 'autoEmbedEnabled',
    type: 'boolean',
    title: 'Auto-Embed on Page Changes',
    description: 'When enabled, the plugin automatically generates embeddings when pages are edited. Disable to prevent background indexing.',
    default: true,
  },
  {
    key: 'autoIndexDebounceSeconds',
    type: 'number',
    title: 'Auto-Index Debounce (seconds)',
    description: 'How long to wait after the last page change before auto-indexing starts. Higher values reduce API calls but delay index updates. Minimum 10 seconds.',
    default: 300,
  },

  // ═══════════════════════════════════════════════════════════════════
  // MEMORY
  // ═══════════════════════════════════════════════════════════════════
  {
    key: 'memoryEnabled',
    type: 'boolean',
    title: 'Enable Agent Memory',
    description: 'When enabled, the AI remembers context across sessions.',
    default: true,
  },
  {
    key: 'autoSummarize',
    type: 'boolean',
    title: 'Auto-summarize Sessions',
    description: 'Automatically summarize conversations when starting a new session.',
    default: true,
  },
  {
    key: 'memoryBudgetPercent',
    type: 'number',
    title: 'Memory Token Budget (%)',
    description: 'Percentage of context window allocated to memory retrieval (1-25).',
    default: 10,
  },

  // ═══════════════════════════════════════════════════════════════════
  // AGENT
  // ═══════════════════════════════════════════════════════════════════
  {
    key: 'agentMode',
    type: 'boolean',
    title: 'Agent Mode',
    description: 'When enabled, autonomous goal detection and multi-step execution are active.',
    default: true,
  },
  {
    key: 'agentAutonomy',
    type: 'enum',
    title: 'Agent Autonomy Level',
    description: 'plan-first shows plan for approval. autopilot executes immediately.',
    default: 'plan-first',
    enumChoices: ['plan-first', 'autopilot'],
    enumPicker: 'select',
  },
  {
    key: 'agentConfidenceThreshold',
    type: 'number',
    title: 'Agent Confidence Threshold',
    description: 'Minimum confidence (0.0-1.0) for goal detection to trigger the agent. Lower = more aggressive, higher = more conservative.',
    default: 0.6,
  },
  {
    key: 'agentTokenBudget',
    type: 'number',
    title: 'Agent Token Budget',
    description: 'Maximum tokens the agent can use per autonomous run (0 = unlimited).',
    default: 100000,
  },
  {
    key: 'agentMaxIterations',
    type: 'number',
    title: 'Agent Max Tool Iterations',
    description: 'Maximum number of iterative tool calls per query or step (ReAct loop limit).',
    default: 25,
  },
  {
    key: 'agentMaxRetries',
    type: 'number',
    title: 'Agent Max Retries Per Step',
    description: 'How many times to retry a failed step before asking for help.',
    default: 2,
  },
  {
    key: 'agentVerboseMode',
    type: 'boolean',
    title: 'Agent Verbose Mode',
    description: 'Show detailed step outputs, self-correction reasoning, and replan details in the progress UI.',
    default: true,
  },
  {
    key: 'agentPersistVerboseToChat',
    type: 'boolean',
    title: 'Persist Agent Steps to Chat',
    description: 'When Agent Verbose Mode is on, stream each completed step as a chat message and keep the full verbose output in the conversation context after the goal finishes.',
    default: false,
  },
  {
    key: 'agentMemoryEnabled',
    type: 'boolean',
    title: 'Agent Memory',
    description: 'Allow the agent to store and recall observations from previous runs, improving performance on recurring tasks.',
    default: true,
  },
  {
    key: 'agentFastModel',
    type: 'string',
    title: 'Agent Fast Model',
    description: 'Optional lightweight model for extraction and gather steps (e.g. gpt-4o-mini). Leave empty to use the main model for all agent steps.',
    default: '',
  },

  // ═══════════════════════════════════════════════════════════════════
  // SKILLS
  // ═══════════════════════════════════════════════════════════════════
  {
    key: 'skillsEnabled',
    type: 'boolean',
    title: 'Enable Agent Skills',
    description: 'When enabled, the AI can use specialized skills stored under Mixer/Skills/ pages. Skills provide focused instructions for specific tasks.',
    default: true,
  },

  // ═══════════════════════════════════════════════════════════════════
  // TOOLS (MCP)
  // ═══════════════════════════════════════════════════════════════════
  {
    key: 'mcpServers',
    type: 'string',
    title: 'MCP Servers Configuration',
    description: 'A JSON object mapping server names to their configurations. Stdio-based servers are not directly supported in the browser sandbox; please use an SSE bridge proxy (e.g. supergateway) to connect them.\nExample:\n{\n  "filesystem": {\n    "url": "http://localhost:3001/sse"\n  }\n}',
    default: '{}',
  },
  {
    key: 'mcpToolTimeout',
    type: 'number',
    title: 'MCP Tool Call Timeout (seconds)',
    description: 'Maximum time to wait for an MCP tool call to complete. Increase for slow tools like browser automation (Playwright). Default 180 seconds (3 minutes).',
    default: 180,
  },

  // ═══════════════════════════════════════════════════════════════════
  // ADVANCED
  // ═══════════════════════════════════════════════════════════════════
  {
    key: 'prompt',
    type: 'string',
    title: 'System Prompt',
    description: 'The system prompt sent with every query. Customize AI behavior, tone, and formatting rules.',
    default: 'You are a knowledge assistant embedded in Logseq. The user\'s notes are organized as pages containing hierarchical blocks (bullet points). Each block may have sub-blocks (children) nested beneath it, forming a tree structure. A sub-block is any block indented one level deeper under a parent block — it represents a detail, elaboration, or child item of that parent. Blocks may reference other pages via [[page links]] or other blocks via ((block refs)). Journal pages are daily entries named by date.\n\nLOGSEQ BLOCK HIERARCHY:\n- Every page contains top-level blocks.\n- Each block can have sub-blocks (children) indented beneath it.\n- Sub-blocks are identified by deeper indentation in the block tree.\n- When asked about "sub-blocks" or "children" of a block, look for blocks indented one level deeper directly under that block.\n- Example: if block A is at indent level 0, its sub-blocks are at indent level 1 directly below it (before the next block at level 0).\n\nCRITICAL FORMATTING RULES (you MUST follow these):\n- ALWAYS wrap page names in double brackets: [[page name]]. Never write a page name without brackets. Examples: [[Project Notes]], [[2026-04-14 tuesday]], [[logseq-mixer]].\n- When citing a specific block, use ((block-uuid)) notation with a UUID from the [block:uuid] annotations in the context. Do NOT fabricate UUIDs.\n  Example: According to ((64a1b2c3-d4e5-6789-abcd-ef0123456789)), the project deadline is next Friday.\n\nPRIORITY RULE:\n- The user\'s direct question or instruction ALWAYS takes priority over any retrieved context.\n- If the user asks you to create, generate, write, or produce something, do EXACTLY what they ask regardless of what context is provided.\n- Only use the retrieved context if it is clearly relevant to the user\'s request.\n- If the context appears unrelated to what the user is asking, IGNORE it entirely and respond based solely on the user\'s instruction.\n\nWhen answering questions about the user\'s notes:\n- Synthesize information from the provided context blocks, even if spread across multiple pages or journal entries.\n- Treat indented child blocks as details or elaborations of their parent block.\n- Pay attention to page names (note_name) and dates — journal entries contain time-specific knowledge.\n- If the context contains relevant blocks from different dates, combine them chronologically.\n- Quote or reference specific blocks when they directly answer the question.\n- If the context is insufficient, say so honestly rather than guessing.',
  },
  {
    key: 'plantumlServer',
    type: 'string',
    title: 'PlantUML Server URL',
    description: 'The PlantUML server endpoint for rendering diagrams. Default uses the public server. For privacy, self-host with: docker run -p 8080:8080 plantuml/plantuml-server:jetty',
    default: 'https://www.plantuml.com/plantuml',
  },

  // ═══════════════════════════════════════════════════════════════════
  // DEPRECATED (kept for backwards compatibility — will be removed)
  // ═══════════════════════════════════════════════════════════════════
  {
    key: 'apiKey',
    type: 'string',
    title: '[Deprecated] API Key',
    description: '⚠️ DEPRECATED — Use the per-provider API key settings (OpenAI/Ollama/LiteLLM API Key). This is only used as a fallback if no per-provider key is set.',
    default: '',
  },
  {
    key: 'chatEndpoint',
    type: 'string',
    title: '[Deprecated] Chat API Endpoint',
    description: '⚠️ DEPRECATED — Use the per-provider endpoint settings (OpenAI/Ollama/LiteLLM Endpoint). This is only used as a fallback if no per-provider endpoint is set.',
    default: '',
  },
  {
    key: 'EmbeddingApiKey',
    type: 'string',
    title: '[Deprecated] Embedding API Key',
    description: '⚠️ DEPRECATED — Use the per-provider embedding API key settings (OpenAI/Ollama/LiteLLM Embedding API Key). This is only used as a fallback.',
    default: '',
  },
  {
    key: 'embeddingEndpoint',
    type: 'string',
    title: '[Deprecated] Embedding API Endpoint',
    description: '⚠️ DEPRECATED — Use the per-provider embedding endpoint settings (OpenAI/Ollama/LiteLLM Embedding Endpoint). This is only used as a fallback.',
    default: '',
  },
  {
    key: 'LiteLLMLink',
    type: 'string',
    title: '[Deprecated] LiteLLM API Link',
    description: '⚠️ DEPRECATED — Use LiteLLM Endpoint setting instead. This is only used as a final fallback.',
    default: '',
  },
  {
    key: 'VectorDBLogseqCopilot',
    type: 'string',
    title: '[Deprecated] Storage Backend',
    description: '⚠️ DEPRECATED — SQLite is now the only supported backend. This setting is ignored.',
    default: 'sqlite',
  },
  // ═══════════════════════════════════════════════════════════════════
  // CROSS-GRAPH SEARCH
  // ═══════════════════════════════════════════════════════════════════
  {
    key: 'crossGraphEnabled',
    type: 'boolean',
    title: 'Cross-Graph Search',
    description: 'When enabled, RAG queries also search other Logseq graphs you have previously indexed. Manage which graphs to include via the 🔌 Database panel. Limitations: results come from the last-indexed snapshot (not live data), embedding models must match, and cross-graph block references are not clickable.',
    default: false,
  },
  {
    key: 'svgSanitization',
    type: 'boolean',
    title: 'SVG Sanitization',
    description: 'Sanitize AI-generated SVGs before rendering (removes scripts, event handlers, and adjusts dark backgrounds). Disable if SVGs appear as black rectangles or have broken colors. ⚠️ Disabling reduces security against malicious SVG content.',
    default: true,
  },
];

export default settings;
