import { queryLiteLLM, resolveChatEndpoint, type ChatMessage } from 'LLMManager';

const CLASSIFICATION_PROMPT = `Classify this user message as either "goal" or "query".
- "goal": A multi-step task requiring autonomous actions (creating pages, organizing notes, researching + writing, bulk operations)
- "query": A question, simple request, single-step action, or conversational message

Respond with ONLY one word: goal or query`;

const OBVIOUS_QUERY_PATTERNS = [
  /^(what|who|where|when|why|how|is|are|can|could|would|does|do|did|tell me|explain|show me|define)\b/i,
  /^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|sure)\b/i,
];

// Single-step write/edit requests that should go through edit mode, not the agent
const SINGLE_ACTION_PATTERNS = [
  /^(write|add|insert|put|create|make)\s+(to\s+)?(a\s+)?(new\s+)?(block|bullet|item|entry|line|note)\b/i,
  /^(write|add|insert|put)\s+(to\s+)?(a\s+)?(new\s+)?(block|bullet|item|entry|line|note)\s+["'""].+["'""]/i,
  /^(write|add|insert|put)\s+["'""].+["'""]\s*(to|in|on|into|under|as)?\s*(a\s+)?(new\s+)?(block|page)?/i,
  /^(update|change|edit|modify|rename|delete|remove)\s+(the\s+)?(block|bullet|this|current)/i,
];

function isObviouslyNotGoal(message: string): boolean {
  const trimmed = message.trim();
  if (trimmed.length < 15) return true;
  if (trimmed.endsWith('?') && trimmed.length < 80) return true;
  if (OBVIOUS_QUERY_PATTERNS.some(p => p.test(trimmed))) return true;
  if (SINGLE_ACTION_PATTERNS.some(p => p.test(trimmed))) return true;
  return false;
}

export async function detectGoal(
  message: string,
  threshold: number = 0.6,
  settings?: any
): Promise<{ isGoal: boolean; confidence: number }> {
  if (isObviouslyNotGoal(message)) {
    return { isGoal: false, confidence: 0 };
  }

  if (!settings?.selectedModel || !resolveChatEndpoint(settings)) {
    return detectGoalRegex(message, threshold);
  }

  try {
    const messages: ChatMessage[] = [
      { role: 'system', content: CLASSIFICATION_PROMPT },
      { role: 'user', content: message },
    ];
    const result = await queryLiteLLM(messages, settings.selectedModel, settings.apiKey, resolveChatEndpoint(settings), undefined, undefined, settings.chatProvider);
    const response = result.choices?.[0]?.message?.content?.trim().toLowerCase() ?? '';
    if (response.startsWith('goal')) {
      return { isGoal: threshold <= 0.8, confidence: 0.85 };
    }
    return { isGoal: false, confidence: 0.15 };
  } catch {
    return detectGoalRegex(message, threshold);
  }
}

function detectGoalRegex(message: string, threshold: number): { isGoal: boolean; confidence: number } {
  const trimmed = message.trim();
  if (trimmed.length < 20) return { isGoal: false, confidence: 0 };

  const GOAL_PATTERNS = [
    /\b(organize|restructure|consolidate|compile|create .+ from|research .+ and|find all .+ and|generate .+ based on|move all|rename all|merge .+ into|transform|convert all|build .+ from|collect .+ and|summarize all|extract .+ from)\b/i,
  ];
  const MULTI_STEP_PATTERNS = [
    /\b(then|after that|next step|followed by|and then|once done)\b/i,
  ];

  let confidence = 0;
  for (const pattern of GOAL_PATTERNS) {
    if (pattern.test(trimmed)) confidence += 0.5;
  }
  for (const pattern of MULTI_STEP_PATTERNS) {
    if (pattern.test(trimmed)) confidence += 0.3;
  }
  if (trimmed.length > 150) confidence += 0.1;

  confidence = Math.min(confidence, 1);
  return { isGoal: confidence >= threshold, confidence };
}
