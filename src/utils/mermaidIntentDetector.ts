/**
 * Mermaid intent detector — checks if a user query or agent step
 * is about creating/generating a Mermaid diagram or chart.
 *
 * Used to conditionally inject Mermaid syntax rules into the system prompt
 * only when relevant, avoiding unnecessary prompt bloat for non-diagram queries.
 */

const MERMAID_INTENT_PATTERNS: RegExp[] = [
  // Explicit mermaid mentions
  /\bmermaid\b/i,
  // Diagram types that map to mermaid
  /\b(flowchart|flow\s*chart|sequence\s*diagram|class\s*diagram|state\s*diagram|er\s*diagram|entity.?relationship)\b/i,
  /\b(gantt\s*chart|gantt\s*diagram|pie\s*chart|pie\s*diagram)\b/i,
  /\b(mindmap|mind\s*map|timeline\s*diagram|user\s*journey)\b/i,
  /\b(git\s*graph|gitgraph|quadrant\s*chart|sankey)\b/i,
  /\b(c4\s*diagram|architecture\s*diagram)\b/i,
  // Generic diagram/chart creation requests
  /\b(create|generate|make|draw|build|design|produce|show)\b.{0,30}\b(diagram|chart|graph|visualization|flowchart|visual)\b/i,
  /\b(diagram|chart|graph|visualization|flowchart|visual)\b.{0,30}\b(of|for|about|showing|depicting|illustrating)\b/i,
  // "visualize" as verb
  /\bvisualize\b/i,
];

/**
 * Determine if the given text (user query or agent step description)
 * involves creating a Mermaid diagram.
 */
export function isMermaidIntent(text: string): boolean {
  if (!text) return false;
  return MERMAID_INTENT_PATTERNS.some(p => p.test(text));
}

/**
 * The Mermaid rules to inject into the system prompt when a diagram is being generated.
 */
export const MERMAID_RULES = `
MERMAID DIAGRAM RULES (CRITICAL — violations will cause parse errors):

The Mermaid parser treats [ ] ( ) # as special syntax characters. If they appear in node labels or style values, the parser fails with errors like "Expecting 'SPACELINE', got 'NODE_DSTART'".

FORBIDDEN patterns inside Mermaid code (these WILL cause parse errors):
- [[page name]] — Logseq page links. Use plain text: "page name"
- [text](logseq://...) — Logseq URL links. Use plain text only.
- [#hexcolor](url) — This is NOT how to color nodes. Use classDef or style syntax.
- Unquoted labels with special chars: A[Label with (parens)] — WRONG

CORRECT patterns:
- Node with special chars: A["Label with (parens) and #hash"]
- Style/classDef colors: classDef highlight fill:#1f8ef1,stroke:#333
- Plain text labels: A[Simple Label]
- If data from context contains [[page links]] or [markdown](links), STRIP the brackets and use only the plain text inside.

Example of what the LLM often does WRONG:
  QEN_Table[QEN Team Member Table fill:[#1f8ef1](logseq://page/1f8ef1)]
Fixed version:
  QEN_Table["QEN Team Member Table"]
  style QEN_Table fill:#1f8ef1

RULE: When using data from the user's notes as node labels, ALWAYS strip all Logseq markup ([[...]], ((...)), [text](url)) and use only the plain text content.`;
