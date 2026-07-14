import { queryLiteLLM, ChatMessage } from '../LLMManager';

const MERMAID_FIX_SYSTEM_PROMPT = `You are a Mermaid diagram syntax expert. The user will provide a broken Mermaid diagram and the error message from the parser. Your job is to fix the syntax error and return ONLY the corrected Mermaid code.

COMMON ERROR: "Expecting 'SPACELINE', got 'NODE_DSTART'" — caused by [ appearing unexpectedly in a node label or style. The Mermaid parser interprets [ as the start of a new node definition.

ROOT CAUSE: Logseq-style markup like [[page name]], [text](logseq://...), or [#color](url) was placed inside node labels or style values. The [ triggers the parser error.

FIX RULES:
- Return ONLY the corrected Mermaid code, no markdown fences, no explanation.
- Strip ALL Logseq/markdown link syntax: [[text]] → "text", [text](url) → "text"
- Move any color values out of node labels into separate style/classDef lines.
- For hex colors in styles: fill:#1f8ef1 (plain, no brackets).
- If node text contains special characters (#, :, (, ), [, ]), wrap in double-quotes: A["Node text"]
- Keep the diagram structure and intent identical — only fix the syntax.
- Never use markdown link syntax or Logseq [[page]] links inside Mermaid code.

Example fix:
  WRONG: QEN_Table[QEN Team fill:[#1f8ef1](logseq://page/1f8ef1)]
  FIXED: QEN_Table["QEN Team"]
         style QEN_Table fill:#1f8ef1`;

/**
 * Attempt to fix a broken Mermaid diagram by asking the LLM.
 * Returns the corrected code or null if the fix fails.
 */
export async function fixMermaidWithLLM(
  brokenCode: string,
  errorMessage: string,
  settings: { selectedModel: string; apiKey: string; chatEndpoint?: string; chatProvider?: string }
): Promise<string | null> {
  const endpoint = settings.chatEndpoint || 'https://api.openai.com/v1/chat/completions';
  const model = settings.selectedModel || 'gpt-4o';
  const apiKey = settings.apiKey || '';
  const provider = settings.chatProvider || 'openai';

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
    const response = await queryLiteLLM(messages, model, apiKey, endpoint, undefined, undefined, provider);
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
