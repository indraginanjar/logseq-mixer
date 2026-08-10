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

  // --- Multilingual: Indonesian ---
  // Creation / generation
  /^(buatkan|buat|tuliskan|tulis|susun|rancang|karang|hasilkan|bikin)\b/i,
  // Transformation
  /^(rangkum|ringkas|terjemahkan|ubah|format|tulis ulang|parafrasa)\b/i,
  // Explanation
  /^(jelaskan|deskripsikan|definisikan|uraikan|terangkan)\b/i,
  // Direct requests for output
  /^(daftarkan|tampilkan|berikan|sediakan|tunjukkan|sebutkan)\b/i,
  // Math / calculation
  /^(hitung|kalkulasi|hitungkan)\b/i,
  // Simple greetings or meta
  /^(halo|hai|terima kasih|makasih|oke|ya|tidak|baik|sip)\b/i,
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

  // --- Multilingual: Indonesian ---
  /\b(catatan saya|grafik saya|halaman saya|jurnal saya|blok saya)\b/i,
  /\b(di logseq|di catatan|dari catatan|dari grafik)\b/i,
  /\b(saya tulis|saya catat|saya sebutkan|pernah saya)\b/i,
  /\b(apa yang saya|kapan saya|dimana saya|apakah saya)\b/i,
  /\b(cari|temukan|carikan)\b.*\b(catatan|halaman|grafik|jurnal)\b/i,
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


/**
 * Patterns indicating the query needs tool access (search, read, write, create pages).
 * If none match, tools can be omitted — the model should answer from RAG context alone.
 */
const TOOL_NEEDED_PATTERNS: RegExp[] = [
  // Explicit tool/action requests
  /\b(search|find|look up|look for|locate|retrieve)\b.*\b(page|block|note|graph)\b/i,
  /\b(create|make|add|insert|write|update|edit|delete|remove)\b.*\b(page|block|note|section|heading)\b/i,
  /\b(read|open|show|get)\s+(the\s+)?(page|block|content of)\b/i,
  // Page manipulation
  /\bcreate\s+(a\s+)?(new\s+)?page\b/i,
  /\binsert\s+(a\s+)?block\b/i,
  /\bupdate\s+(the\s+)?block\b/i,
  /\bdelete\s+(the\s+)?block\b/i,
  // MCP / external tools
  /\b(web search|browse|fetch|download|run|execute)\b/i,
  // OS / shell commands via MCP
  /\b(open|launch|start)\s+\S/i,
  // Skill invocation
  /^\/skill\b/i,
  // Multi-step / agent-like imperatives that need graph interaction
  /\b(find all|gather|collect|extract from|across all|every page)\b/i,
  // Explicit requests to use tools
  /\b(use|call|invoke)\s+(a\s+)?(tool|function|search)\b/i,
];

/**
 * Patterns that strongly indicate no tools are needed — simple Q&A or chat.
 * These override tool detection if matched.
 */
const NO_TOOLS_PATTERNS: RegExp[] = [
  /\bdo not use\s+(any\s+)?tools\b/i,
  /\bwithout\s+(using\s+)?(any\s+)?tools\b/i,
  /\bno tools\b/i,
  /\bjust answer\b/i,
  /\bfrom (the\s+)?(context|information|notes)\s+(above|provided|given|below)\b/i,
];

/**
 * Determine whether tool schemas should be included in the LLM request.
 *
 * Returns `true` if the query likely needs tool access (search/read/write/MCP).
 * Returns `false` if it's a simple Q&A that can be answered from RAG context alone.
 *
 * When `false`, tools are not sent — preventing weaker models from hallucinating
 * tool call syntax and improving response quality for straightforward questions.
 *
 * @param query - The user's message
 * @param hasRetrievedContext - Whether RAG context was successfully retrieved
 * @param editMode - Whether Allow Graph Edits mode is active (always needs tools)
 */
export function shouldIncludeTools(query: string, hasRetrievedContext: boolean, editMode: boolean): boolean {
  // Edit mode always needs write tools
  if (editMode) return true;

  // Explicit "no tools" instruction from user
  if (NO_TOOLS_PATTERNS.some(p => p.test(query))) return false;

  // If the query matches a tool-needed pattern, include tools
  if (TOOL_NEEDED_PATTERNS.some(p => p.test(query))) return true;

  // If we have RAG context and the query doesn't explicitly need tools,
  // skip tools — the model can answer from context alone
  if (hasRetrievedContext) return false;

  // No RAG context and no clear signal → include tools so the model can search
  return true;
}
