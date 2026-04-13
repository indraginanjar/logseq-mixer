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
    default: 'You are an AI assistant built into LogSeq. answer based on context. newer context takes priority',
  },
  {
    key: 'EmbeddingApiKey',
    type: 'string',
    title: 'Embedding AI ApiKey',
    description: 'api key passed to embedding model. (for now only openai\'s "text-embedding-ada-002" model is supported)',
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
