import { SettingSchemaDesc } from '@logseq/libs/dist/LSPlugin';

// our LiteLLM server is only configured with these models
const settings: SettingSchemaDesc[] = [
  {
    key: 'selectedModel',
    type: 'enum',
    title: 'Selected Model',
    description: 'Choose the model to use for the plugin (powered by LITELLM)',
    default: 'gpt-3.5-turbo',
    enumChoices: [
      'gpt-3.5-turbo',
      'gpt-4',
      'gpt-4o',
      'claude-2',
      'claude-3-opus',
      'gemini-pro',
      'codestral/codestral-latest',
      'deepseek-chat'
    ],    
    enumPicker: 'select'
  },
  {
    key: 'prompt',
    type: 'string',
    title: 'AI prompt',
    description: 'This text is input in front of every query.\n("context" is variables passed to the ai, leave it in the prompt so the AI knows what to do with your data)',
    default: 'You are a knowledge assistant embedded in Logseq. The user\'s notes are organized as pages containing hierarchical blocks (bullet points). Each block may reference other pages via [[page links]] or other blocks via ((block refs)). Journal pages are daily entries named by date.\n\nWhen answering:\n- Synthesize information from ALL provided context blocks, even if spread across multiple pages or journal entries.\n- Treat indented child blocks as details or elaborations of their parent block.\n- Pay attention to page names (note_name) and dates — journal entries contain time-specific knowledge.\n- If the context contains relevant blocks from different dates, combine them chronologically.\n- Quote or reference specific blocks when they directly answer the question.\n- If the context is insufficient, say so honestly rather than guessing.\n- When citing a specific block, use the ((block-uuid)) notation with a UUID from the [block:uuid] annotations in the context. Do NOT fabricate UUIDs.\n  Example: According to ((64a1b2c3-d4e5-6789-abcd-ef0123456789)), the project deadline is next Friday.\n\nContext from the user\'s knowledge base:',
  },
  {
    key: 'EmbeddingApiKey',
    type: 'string',
    title: 'Embedding AI ApiKey',
    description: 'API key for OpenAI embedding models (used for semantic search over your notes).',
    default: 'sk-proj-1234',
  },
  {
    key: 'embeddingModel',
    type: 'enum',
    title: 'Embedding Model',
    description: 'Choose the OpenAI embedding model. Changing this will re-create the vector database.',
    default: 'text-embedding-3-small',
    enumChoices: ['text-embedding-ada-002', 'text-embedding-3-small', 'text-embedding-3-large'],
    enumPicker: 'select',
  },
  {
    key: 'LiteLLMLink',
    type: 'string',
    title: 'LiteLLM api link',
    description: 'LiteLLM\'s api endpoint, replace with your own if you want custom models',
    default: 'http://172.105.80.74:4000/chat/completions',
  },
  {
    key: 'apiKey',
    type: 'string',
    title: 'API Key',
    description: 'Enter your API key for the service',
    default: 'sk-proj-1234',
  },
  {
    key: 'indexingMode',
    type: 'enum',
    title: 'Indexing Mode',
    description: 'Incremental only embeds new/updated pages. Full Re-index wipes the database and re-embeds everything.',
    default: 'incremental',
    enumChoices: ['incremental', 'full'],
    enumPicker: 'select',
  },
  {
    key: 'storageBackend',
    type: 'enum',
    title: 'Storage Backend',
    description: 'Where to store the vector database. "sqlite" (recommended) stores data in a local SQLite file for better performance and external access. "settings" is the legacy option that stores data in Logseq plugin settings.',
    default: 'sqlite',
    enumChoices: ['sqlite', 'settings'],
    enumPicker: 'select',
  }
];

export default settings;
