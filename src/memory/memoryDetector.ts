const TRIGGER_PHRASES = [
  'remember this',
  'remember that',
  'keep in mind',
  'note for future',
  "don't forget",
  'please remember',
];

function detectCategory(content: string): string {
  const lower = content.toLowerCase();
  if (/\b(prefer|always|never|style|format|don't like|like to)\b/.test(lower)) return 'preference';
  if (/\b(todo|task|deadline|remind me to|need to)\b/.test(lower)) return 'task';
  return 'fact';
}

export function detectExplicitMemory(userMessage: string): { shouldRemember: boolean; content: string; category: string } | null {
  const lower = userMessage.toLowerCase();
  for (const phrase of TRIGGER_PHRASES) {
    const idx = lower.indexOf(phrase);
    if (idx === -1) continue;
    const afterTrigger = userMessage.slice(idx + phrase.length).trim();
    const content = afterTrigger.length > 0 ? afterTrigger : userMessage;
    return { shouldRemember: true, content, category: detectCategory(content) };
  }
  return null;
}
