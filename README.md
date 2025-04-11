# Logseq Composer ✍️

**Logseq Composer** is a plugin that connects your notes with any LLM using Retrieval-Augmented Generation (RAG). Hope you find it useful! 😀👍🍀🍷

https://www.youtube.com/watch?v=J0QDrz-Ccis

---

### ⚙️📚 How it works

- Uses [OpenAI embeddings](https://platform.openai.com/docs/guides/embeddings) for vector search
- Retrieves relevant notes using RAG (simple Vector search for now)
- Pipes the results into any LLM via [LiteLLM](https://github.com/BerriAI/litellm)
- You can use **any LLM** supported by LiteLLM (chatgpt 4o, deepseek, Claude, etc.)
- Currently, an **OpenAI API key is required for embeddings** – but the plugin will still run

---

### ⚙️ Settings
Descriptions are included with the plugin but here is more context.
- selectedModel: model name (string) passed into liteLLM
- prompt: the text at the top of the prompt, "context" is the name of json passed to the LLM in each query, include it in your prompt for better contextual thinking. the default is pretty good, as i have tested it.
- EmbeddingApiKey: api key used for an embedding model, currently only openai's "text-embedding-ada-002" model is supported and you need an openAI API key for embedding with this plugin. however the plugin will run without an embedding key, you will just have to look at the currect note you are working with (currently looked at note is always being passed to the LLM as extra context)
- LiteLLMLink: this setting is open, for users who would like to run their own local models using OLLAMA or other models. the default value ([http://172.105.80.74:4000/chat/completions](http://172.105.80.74:4000/chat/completions)) is our personal liteLLM instance, that just passes your API keys to their respective platforms, use it if you don't want to configure your own liteLLM session. otherwise setup your own liteLLM server and pass it to the plugin.
- apiKey: the API key passed to the remote LLM, by default our liteLLM passes this key to the respective service openAI, google, etc.
---

### ⚠️ Early Stage Notice

This is my **first Logseq plugin**, and it's **under heavy development**, with updates coming in the future.  
If something breaks or you'd like a feature or give feedback, please:

- Be patient 🙏
- [Create an issue](https://github.com/martindev9999/logseq-composer/issues)

---

### 📦 Installation

- Install it from the marketplace
- Configure your keys
- enjoy!

---

### 📄 License

Usage is allowed, but redistribution, resale, or modification is **not**.  
See `LICENSE` for details.
