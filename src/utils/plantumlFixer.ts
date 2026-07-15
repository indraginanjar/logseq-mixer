import { queryLiteLLM, ChatMessage } from '../LLMManager';

const PLANTUML_FIX_SYSTEM_PROMPT = `You are a PlantUML syntax expert. The user will provide a broken PlantUML diagram and an error description. Fix the syntax and return ONLY the corrected PlantUML code.

COMMON ERRORS AND FIXES:

1. Missing @startuml / @enduml — every PlantUML diagram MUST start with @startuml and end with @enduml.
2. Invalid arrow syntax — use --> for solid arrows, ..> for dashed, -|> for inheritance.
3. Unmatched brackets or quotes.
4. Invalid characters in identifiers — wrap names with spaces in double-quotes: "My Class".
5. Logseq markup [[page]] or [text](url) inside diagram — strip to plain text.

RULES:
- Return ONLY the corrected PlantUML code, no markdown fences, no explanation.
- Always include @startuml at the start and @enduml at the end.
- Keep ALL data and structure — only fix syntax.
- Do NOT use emoji characters in labels.
- If identifiers contain special characters, wrap them in double-quotes.`;

/**
 * Attempt to fix a broken PlantUML diagram by asking the LLM.
 * Returns the corrected code or null if the fix fails.
 */
export async function fixPlantUMLWithLLM(
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
    console.warn('[plantumlFixer] No endpoint configured, cannot fix');
    return null;
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: PLANTUML_FIX_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Fix this PlantUML diagram. It has a syntax error.

ERROR:
${errorMessage}

BROKEN CODE:
${brokenCode}

Return ONLY the fixed PlantUML code, nothing else.`,
    },
  ];

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    const response = await queryLiteLLM(messages, model, apiKey, endpoint, controller.signal, undefined, provider);
    clearTimeout(timeoutId);

    const content = response?.choices?.[0]?.message?.content?.trim();
    if (!content) return null;

    // Strip markdown code fences if the LLM wrapped the response
    let fixed = content;
    if (fixed.startsWith('```plantuml')) {
      fixed = fixed.slice('```plantuml'.length);
    } else if (fixed.startsWith('```puml')) {
      fixed = fixed.slice('```puml'.length);
    } else if (fixed.startsWith('```')) {
      fixed = fixed.slice(3);
    }
    if (fixed.endsWith('```')) {
      fixed = fixed.slice(0, -3);
    }
    fixed = fixed.trim();

    // Ensure @startuml and @enduml are present
    if (!fixed.startsWith('@startuml')) {
      fixed = '@startuml\n' + fixed;
    }
    if (!fixed.endsWith('@enduml')) {
      fixed = fixed + '\n@enduml';
    }

    return fixed || null;
  } catch (err) {
    console.error('[plantumlFixer] Failed to fix PlantUML code:', err);
    return null;
  }
}
