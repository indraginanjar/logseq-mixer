/**
 * Mermaid code sanitizer — programmatically fixes common Logseq-specific
 * patterns that break Mermaid parsing BEFORE sending to the renderer.
 *
 * This catches issues that LLMs produce even when instructed not to,
 * because they copy Logseq markup from the RAG context into Mermaid code.
 */

/**
 * Sanitize mermaid code by removing Logseq-specific markup patterns
 * that cause parse errors like "Expecting 'SPACELINE', got 'NODE_DSTART'".
 *
 * Returns the sanitized code (may be unchanged if no issues found).
 */
export function sanitizeMermaidCode(code: string): string {
  let result = code;

  // Fix: [#hexcolor](logseq://...) or [text](logseq://...) inside node labels
  // e.g., fill:[#1f8ef1](logseq://page/1f8ef1) → fill:#1f8ef1
  result = result.replace(/\[#([0-9a-fA-F]{3,8})\]\([^)]*\)/g, '#$1');

  // Fix: [text](logseq://...) → "text"
  result = result.replace(/\[([^\]]*)\]\(logseq:\/\/[^)]*\)/g, '"$1"');

  // Fix: [[page name]] inside lines (Logseq page links) → "page name"
  // But be careful not to replace Mermaid's own [[...]] subgraph syntax
  // Only replace when it appears inside node definitions (after [ or inside quotes)
  result = result.replace(/\[\[([^\]]+)\]\]/g, (match, content, offset) => {
    // Check if this is at the start of a line (likely a Mermaid subgraph or similar)
    const lineStart = result.lastIndexOf('\n', offset);
    const linePrefix = result.slice(lineStart + 1, offset).trim();
    // If the line starts with keywords that use [[]], keep it
    if (/^(subgraph|end|direction|click)/.test(linePrefix)) {
      return match;
    }
    return `"${content}"`;
  });

  // Fix: Unbalanced brackets in node labels that aren't properly quoted
  // Pattern: NodeId[Label with [nested] brackets] → NodeId["Label with [nested] brackets"]
  // This is complex — only apply if the line has a clear NODE_DSTART issue pattern
  // (label containing [ after the opening [ of the node definition)
  result = result.replace(
    /^(\s*\w+)\[([^\]"]*\[[^\]]*\][^\]]*)\]$/gm,
    (_, nodeId, label) => `${nodeId}["${label.replace(/\[/g, '(').replace(/\]/g, ')')}"]`
  );

  return result;
}
