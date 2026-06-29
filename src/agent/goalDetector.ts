const GOAL_PATTERNS = [
  /\b(organize|restructure|consolidate|compile|create .+ from|research .+ and|find all .+ and|generate .+ based on|move all|rename all|merge .+ into|set up|transform|convert all|build .+ from|collect .+ and|summarize all|extract .+ from)\b/i,
  /\b(then|after that|next|finally|and also|followed by|and then|once done)\b/i,
];

const QUESTION_PATTERNS = [
  /^(what|who|where|when|why|how|is|are|can|could|would|does|do|did|tell me|explain)\b/i,
  /\?$/,
];

export function detectGoal(message: string, threshold = 0.6): { isGoal: boolean; confidence: number } {
  const trimmed = message.trim();
  if (trimmed.length < 20) return { isGoal: false, confidence: 0 };

  const isQuestion = QUESTION_PATTERNS.some(p => p.test(trimmed));
  if (isQuestion && trimmed.length < 100) return { isGoal: false, confidence: 0.1 };

  let confidence = 0;
  for (const pattern of GOAL_PATTERNS) {
    if (pattern.test(trimmed)) confidence += 0.4;
  }

  const verbCount = (trimmed.match(/\b(and|then|,)\b/g) || []).length;
  if (verbCount >= 2) confidence += 0.3;

  if (trimmed.length > 150) confidence += 0.1;

  confidence = Math.min(confidence, 1);
  return { isGoal: confidence >= threshold, confidence };
}
