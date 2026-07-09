/**
 * Intent classifier to determine whether a user query needs RAG context retrieval.
 *
 * Direct instructions (create, generate, translate, etc.) don't benefit from
 * injecting knowledge base context and may be harmed by irrelevant context
 * that distracts the LLM from the user's actual request.
 */

/**
 * Patterns that strongly indicate a direct instruction/generation task
 * where RAG context is unlikely to help.
 */
const DIRECT_INSTRUCTION_PATTERNS: RegExp[] = [
  // Creation / generation
  /^(create|generate|make|write|build|design|draft|compose|produce)\b/i,
  // Transformation
  /^(summarize|translate|convert|format|reformat|rewrite|paraphrase)\b/i,
  // Explanation of general concepts (not notes)
  /^(explain|describe|define)\s+(what|how|why|the\s+concept|the\s+difference)\b/i,
  // Direct requests for output
  /^(list|show me|give me|provide)\s+(a|an|the|some)?\s*(table|list|example|code|script|template|outline|plan|schedule)\b/i,
  // Math / calculation
  /^(calculate|compute|solve|evaluate)\b/i,
  // Code generation
  /^(code|implement|program|debug|fix this|refactor)\b/i,
  // Role-play / persona
  /^(act as|pretend|you are|imagine)\b/i,
  // Simple greetings or meta
  /^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|sure)\b/i,
];

/**
 * Patterns that indicate the user wants information FROM their notes/graph,
 * meaning RAG retrieval IS needed even if the query also looks instructional.
 */
const NOTES_REFERENCE_PATTERNS: RegExp[] = [
  /\b(my notes|my graph|my pages|my journal|my blocks)\b/i,
  /\b(in logseq|in my|from my|from the graph)\b/i,
  /\b(i wrote|i noted|i mentioned|i recorded|i logged)\b/i,
  /\b(what did i|when did i|where did i|have i)\b/i,
  /\b(find|search|look up|look for|recall)\b.*\b(my|notes|pages|graph|journal)\b/i,
  /\[\[.+\]\]/,  // contains [[page link]] references
  /\(\(.+\)\)/,  // contains ((block ref)) references
];

/**
 * Determine whether RAG context retrieval should be performed for a given query.
 *
 * Returns `true` if retrieval is likely useful (knowledge question about notes).
 * Returns `false` if the query is a direct instruction that doesn't need note context.
 */
export function shouldRetrieveContext(query: string): boolean {
  const trimmed = query.trim();

  // Very short queries (1-2 words) — likely a greeting or simple command, skip RAG
  const wordCount = trimmed.split(/\s+/).length;
  if (wordCount <= 2 && !NOTES_REFERENCE_PATTERNS.some(p => p.test(trimmed))) {
    return false;
  }

  // If the query explicitly references the user's notes/graph, always retrieve
  if (NOTES_REFERENCE_PATTERNS.some(p => p.test(trimmed))) {
    return true;
  }

  // If the query matches a direct instruction pattern, skip retrieval
  if (DIRECT_INSTRUCTION_PATTERNS.some(p => p.test(trimmed))) {
    return false;
  }

  // Default: retrieve context (assume it's a knowledge question)
  return true;
}
