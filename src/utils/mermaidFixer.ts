import { queryLiteLLM, ChatMessage } from '../LLMManager';

const MERMAID_FIX_SYSTEM_PROMPT = `You are a Mermaid diagram syntax expert. The user will provide a broken Mermaid diagram and the error message from the parser. Your job is to fix the syntax error and return ONLY the corrected Mermaid code.

COMMON ERRORS AND FIXES:

1. "Expecting 'SPACELINE', got 'NODE_DSTART'" — caused by [ appearing unexpectedly.
   FIX: Strip Logseq markup ([[text]] → text, [text](url) → text). Quote labels with special chars: A["text"].

2. "There can be only one root. No parent could be found for (X)" — in mindmaps, every node except root MUST be indented under its parent. Node X has no indentation or same level as root.
   FIX: Ensure proper indentation hierarchy. Every child must be indented deeper than its parent:
   WRONG:
     mindmap
       root((Title))
       Child1
       Child2
   FIXED:
     mindmap
       root((Title))
         Child1
         Child2

3. "style" or "classDef" lines in mindmaps — mindmaps don't support standalone style lines.
   FIX: Remove style/classDef lines from mindmaps, or use :::className inline.

RULES:
- Return ONLY the corrected Mermaid code, no markdown fences, no explanation, no commentary.
- Keep ALL data/content — do not remove nodes, just fix the structure.
- For mindmaps: ensure every non-root node is indented with spaces under its parent.
- Strip Logseq-specific markup: [[text]] → text, [text](logseq://...) → text
- For hex colors in styles (flowcharts only): fill:#1f8ef1 (plain, no brackets).
- If node text has special characters, wrap in double-quotes.`;

/**
 * Attempt to fix a broken Mermaid diagram by asking the LLM.
 * Returns the corrected code or null if the fix fails.
 */
export async function fixMermaidWithLLM(
  brokenCode: string,
  errorMessage: string,
  settings: {
    selectedModel?: string;
    apiKey?: string;
    chatEndpoint?: string;
    chatProvider?: string;
    LiteLLMLink?: string;
  }
): Promise<string | null> {
  const endpoint = settings.chatEndpoint || settings.LiteLLMLink || 'https://api.openai.com/v1/chat/completions';
  const model = settings.selectedModel || 'gpt-4o';
  const apiKey = settings.apiKey || '';
  const provider = settings.chatProvider || 'openai';

  if (!endpoint) {
    console.warn('[mermaidFixer] No endpoint configured, cannot fix');
    return null;
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: MERMAID_FIX_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Fix this Mermaid diagram. It has a syntax error.

ERROR:
${errorMessage}

BROKEN CODE:
${brokenCode}

Return ONLY the fixed Mermaid code, nothing else.`,
    },
  ];

  try {
    // Add a 30-second timeout to prevent hanging indefinitely
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    const response = await queryLiteLLM(messages, model, apiKey, endpoint, controller.signal, undefined, provider);
    clearTimeout(timeoutId);

    const content = response?.choices?.[0]?.message?.content?.trim();
    if (!content) return null;

    // Strip markdown code fences if the LLM wrapped the response
    let fixed = content;
    if (fixed.startsWith('```mermaid')) {
      fixed = fixed.slice('```mermaid'.length);
    } else if (fixed.startsWith('```')) {
      fixed = fixed.slice(3);
    }
    if (fixed.endsWith('```')) {
      fixed = fixed.slice(0, -3);
    }
    fixed = fixed.trim();

    return fixed || null;
  } catch (err) {
    console.error('[mermaidFixer] Failed to fix mermaid code:', err);
    return null;
  }
}
