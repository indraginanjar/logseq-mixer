/**
 * Diagram intent detector — checks if a user query or agent step
 * is about creating/generating a diagram (Mermaid or PlantUML).
 *
 * Used to conditionally inject diagram syntax rules into the system prompt
 * only when relevant, avoiding unnecessary prompt bloat for non-diagram queries.
 */

// ─── Mermaid Detection ────────────────────────────────────────────────────────

const MERMAID_INTENT_PATTERNS: RegExp[] = [
  /\bmermaid\b/i,
  /\b(flowchart|flow\s*chart|state\s*diagram|er\s*diagram|entity.?relationship)\b/i,
  /\b(gantt\s*chart|gantt\s*diagram|pie\s*chart|pie\s*diagram)\b/i,
  /\b(mindmap|mind\s*map|timeline\s*diagram|user\s*journey)\b/i,
  /\b(git\s*graph|gitgraph|quadrant\s*chart|sankey)\b/i,
  /\b(c4\s*diagram)\b/i,
];

export function isMermaidIntent(text: string): boolean {
  if (!text) return false;
  return MERMAID_INTENT_PATTERNS.some(p => p.test(text));
}

// ─── PlantUML Detection ───────────────────────────────────────────────────────

const PLANTUML_INTENT_PATTERNS: RegExp[] = [
  /\bplantuml\b/i,
  /\bplant\s*uml\b/i,
  /\bpuml\b/i,
  /\b(class\s*diagram|component\s*diagram|deployment\s*diagram|object\s*diagram|use\s*case\s*diagram)\b/i,
  /\b(activity\s*diagram|sequence\s*diagram)\b/i,
];

export function isPlantUMLIntent(text: string): boolean {
  if (!text) return false;
  return PLANTUML_INTENT_PATTERNS.some(p => p.test(text));
}

// ─── Combined Detection ───────────────────────────────────────────────────────

const GENERIC_DIAGRAM_PATTERNS: RegExp[] = [
  /\b(create|generate|make|draw|build|design|produce|show)\b.{0,30}\b(diagram|chart|graph|visualization|flowchart|visual)\b/i,
  /\b(diagram|chart|graph|visualization|flowchart|visual)\b.{0,30}\b(of|for|about|showing|depicting|illustrating)\b/i,
  /\bvisualize\b/i,
  /\b(architecture\s*diagram)\b/i,
];

/**
 * Returns true if the text is about creating any kind of diagram.
 */
export function isDiagramIntent(text: string): boolean {
  if (!text) return false;
  return isMermaidIntent(text) || isPlantUMLIntent(text) || GENERIC_DIAGRAM_PATTERNS.some(p => p.test(text));
}

// ─── Mermaid Rules ────────────────────────────────────────────────────────────

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
- Do NOT put "style" or "classDef" as separate lines INSIDE the tree — they are interpreted as nodes.

DIAGRAM-SPECIFIC STYLING:
- flowchart/graph: Use "style NodeId fill:#color" or "classDef" on separate lines.
- mindmap: Colors are NOT supported via :::className. Do NOT use :::color syntax. Rely on the tree structure without colors.
- sequence/gantt/pie: Use the diagram's own configuration syntax.`;

// ─── PlantUML Rules ───────────────────────────────────────────────────────────

export const PLANTUML_RULES = `
PLANTUML DIAGRAM RULES:

When generating PlantUML diagrams, use a \`\`\`plantuml code block.

REQUIRED STRUCTURE:
- Every PlantUML diagram MUST start with @startuml and end with @enduml
- Example:
    @startuml
    Alice -> Bob: Hello
    Bob --> Alice: Hi
    @enduml

SYNTAX RULES:
- Do NOT use emoji characters in labels — they may not render.
- Convert [[page name]] from context → use plain text "page name" in labels.
- Convert [text](logseq://...) → use plain text "text" in labels.
- Wrap identifiers with spaces in double-quotes: class "My Class" { }
- Arrows: --> (solid), ..> (dashed), -|> (inheritance), --* (composition), --o (aggregation)

PLANTUML IS BEST FOR:
- Class diagrams (inheritance, methods, attributes)
- Sequence diagrams (complex interactions with lifelines)
- Component diagrams (system architecture)
- Deployment diagrams (servers, containers)
- Activity diagrams (complex workflows with branching)
- Use case diagrams

REMEMBER: Use ALL the data provided (names, statuses, relationships, etc.) — just ensure PlantUML syntax is correct.`;

// ─── Combined Rules ───────────────────────────────────────────────────────────

export const DIAGRAM_RULES = `
DIAGRAM FORMAT SELECTION:
You can generate diagrams using EITHER Mermaid or PlantUML. Choose the best format for the request:

USE MERMAID (\`\`\`mermaid) FOR:
- Flowcharts and process flows
- Mindmaps and tree structures
- Pie charts and Gantt charts
- Simple sequence diagrams
- ER diagrams
- State diagrams

USE PLANTUML (\`\`\`plantuml) FOR:
- UML class diagrams (with methods, attributes, inheritance)
- Complex sequence diagrams (lifelines, activation, alt/opt blocks)
- Component and deployment diagrams
- Activity diagrams with complex branching
- Use case diagrams
- Object diagrams

If the user explicitly requests a format (e.g., "make a mermaid diagram" or "create a plantuml class diagram"), use that format.

${MERMAID_RULES}

${PLANTUML_RULES}

REMEMBER: Use ALL the data provided (names, statuses, etc.) — just ensure the diagram syntax is clean and correct.`;
