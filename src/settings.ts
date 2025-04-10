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
    key: 'LiteLLMLink',
    type: 'string',
    title: 'LiteLLM api link',
    description: 'LiteLLM\'s api endpoint, replace with your own if you want custom models',
    default: 'http://localhost:4000/chat/completions',
  },
  {
    key: 'apiKey',
    type: 'string',
    title: 'API Key',
    description: 'Enter your API key for the service',
    default: 'sk-proj-1234',
  },
  {
    key: 'VectorDBLogseqCopilot',
    type: 'string',
    title: 'VectorDBLogseqCopilot DEV!',
    description: 'VectorDB JSON dont edit',
    default: '',
  }
];

export default settings;
