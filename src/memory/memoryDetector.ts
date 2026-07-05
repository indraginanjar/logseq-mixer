const TRIGGER_PHRASES = [
  'remember this:',
  'remember that ',
  'keep in mind:',
  'note for future:',
  "don't forget:",
  'please remember:',
  'remember this,',
  'remember that,',
];

const FALSE_TRIGGERS = [
  /don't forget (things|easily|stuff|about it)/i,
  /can you remember that for me/i,
  /do you remember/i,
  /i remember/i,
];

function detectCategory(content: string): string {
  const lower = content.toLowerCase();
  if (/\b(prefer|always use|never use|style|format|don't like|like to|want .+ to be)\b/.test(lower)) return 'preference';
  if (/\b(todo|task|deadline|remind me to|need to|by .+ date|due)\b/.test(lower)) return 'task';
  return 'fact';
}

export function detectExplicitMemory(userMessage: string): { shouldRemember: boolean; content: string; category: string } | null {
  const lower = userMessage.toLowerCase();

  if (FALSE_TRIGGERS.some(p => p.test(lower))) return null;

  for (const phrase of TRIGGER_PHRASES) {
    const idx = lower.indexOf(phrase);
    if (idx === -1) continue;
    const afterTrigger = userMessage.slice(idx + phrase.length).trim();
    if (afterTrigger.length < 5) continue;
    return { shouldRemember: true, content: afterTrigger, category: detectCategory(afterTrigger) };
  }

  const simpleMatch = lower.match(/\bremember (this|that)\b/);
  if (simpleMatch) {
    const idx = lower.indexOf(simpleMatch[0]);
    const afterTrigger = userMessage.slice(idx + simpleMatch[0].length).trim();
    if (afterTrigger.length >= 10 && (idx < 3 || /^[,:—\-]/.test(afterTrigger))) {
      const content = afterTrigger.replace(/^[,:—\-]\s*/, '');
      if (content.length >= 5) return { shouldRemember: true, content, category: detectCategory(content) };
    }
  }

  return null;
}
