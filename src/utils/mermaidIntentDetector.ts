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
MERMAID DIAGRAM RULES (output formatting only — still use ALL data from context):

IMPORTANT: These rules are ONLY about how to format the Mermaid code output. You must still READ and USE all data from the context (names, statuses, values, etc.) — just output them as plain text in the diagram without Logseq markup.

The Mermaid parser treats [ ] ( ) # as special syntax characters. If they appear in node labels or style values, the parser fails with errors like "Expecting 'SPACELINE', got 'NODE_DSTART'".

WHEN WRITING MERMAID CODE:
- Convert [[page name]] from context → use "page name" as plain text in node labels
- Convert [text](logseq://...) from context → use "text" as plain text in node labels
- For colors in styles: fill:#1f8ef1 (plain hex, no brackets or links)
- If node text contains special characters (#, :, (, ), [, ]), wrap in double-quotes: A["Label"]
- Do NOT use emoji characters (🟩🟨🟧✅❌ etc.) in node labels — they crash the renderer. Use plain text or color styling instead.

MINDMAP CRITICAL RULES (errors here cause "There can be only one root"):
- There must be exactly ONE root node. ALL other nodes must be indented children.
- Indentation defines hierarchy — every child MUST be indented deeper (more spaces) than its parent.
- Do NOT put "style" or "classDef" as separate lines in mindmaps — they are interpreted as nodes.
- Correct mindmap structure:
    mindmap
      root((Central Topic))
        Branch1
          Leaf1
          Leaf2
        Branch2
          Leaf3

DIAGRAM-SPECIFIC STYLING:
- flowchart/graph: Use "style NodeId fill:#color" or "classDef" on separate lines.
- mindmap: Use :::className inline only. No standalone style lines.
- sequence/gantt/pie: Use the diagram's own configuration syntax.

REMEMBER: Use ALL the data provided (names, statuses, etc.) — just ensure the Mermaid syntax is clean.`;
