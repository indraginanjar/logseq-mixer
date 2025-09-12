# Logseq Composer ✍️

**Logseq Composer** is a plugin that connects your Logseq notes with any LLM using Retrieval-Augmented Generation (RAG).  
Hope you find it useful! 😀👍🍀🍷

### For the LLM to have access to your files you NEED TO RE-INDEX DB (bottom left green button, it may take a while depending on the size of the notes)

🎥 [Watch demo](https://www.youtube.com/watch?v=J0QDrz-Ccis)

**Support me to help the project ❤️**

<a href="https://www.buymeacoffee.com/yoyurec](https://buymeacoffee.com/martinminarik" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" style="height: 50px !important;width: 178px !important;" ></a>

---

### ⚙️ How It Works

- Uses [OpenAI embeddings](https://platform.openai.com/docs/guides/embeddings) for semantic vector search
- Retrieves related notes using RAG (vector similarity search for now)
- Passes context into **any LLM** using [LiteLLM](https://github.com/BerriAI/litellm)
- Supports **all LiteLLM-compatible models**, including ChatGPT 4o, Claude, DeepSeek, Gemini, and local models via OLLAMA (with extra configuration)
- Plugin still runs without embeddings — the currently active note will be passed as fallback context

---

### ⚠️ Early Stage Notice

This is my **first Logseq plugin**, and it's still in **heavy development** with updates coming soon.  
If something breaks or you'd like to suggest a feature or improvement:

- Please be patient 🙏
- [Create an issue](https://github.com/martindev9999/logseq-composer/issues)

---

### 🛠 Plugin Settings (Detailed)

You can configure these in the Logseq plugin UI:

- **`selectedModel`**  
  - Example: `"gpt-4o"`  
  - The name of the LLM model to use. This is passed directly into LiteLLM, so it should match a valid model from the provider you're using.

- **`prompt`**  
  - This is the custom prompt shown to the LLM with every query.  
  - The word `"context"` inside your prompt is replaced by the text content pulled from your notes (via vector search or current page).  
  - Default is tuned for productivity, but you can customize it for different LLM personalities or task types.

- **`EmbeddingApiKey`**  
  - Used for generating vector embeddings of your notes (for semantic search).  
  - Currently only supports OpenAI’s `text-embedding-ada-002` model.  
  - If not set, vector search is skipped and only the current Logseq note is passed as context.  
  - You do **not** need this if you're okay with simpler functionality.

- **`LiteLLMLink`**   
  - The full endpoint to your LiteLLM instance.  
  - Default value:  
    ```
    http://172.105.80.74:4000/chat/completions
    ```
  - This is a public instance that forwards your request to the correct provider (OpenAI, Google, etc.) using your API key.  
  - You can self-host [LiteLLM](https://github.com/BerriAI/litellm) for full control or privacy — just set your own URL here.

- **`apiKey`**  
  - The API key used to authenticate your request with the actual LLM provider (OpenAI, Anthropic, Google, etc.).  
  - This key is passed to LiteLLM which handles routing and forwarding it properly.  
  - **Keep this secure**, especially if using shared or public LiteLLM endpoints.

---

### 📦 Installation

- Install it from the Logseq Marketplace (once it's approved)
- Open plugin settings and configure your:
  - API key
  - LLM model
  - (Optional) Embedding key
  - (Optional) Custom LiteLLM server
- Start composing with full context-awareness inside Logseq!

---

### 📄 License

This project is open-source and licensed under the **MIT License**.  
You’re free to:
- Use
- Copy
- Modify
- Distribute

Please see the [`LICENSE`](./LICENSE) file for full details.
