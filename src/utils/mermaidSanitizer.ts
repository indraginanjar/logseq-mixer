/**
 * Mermaid code sanitizer — programmatically fixes common Logseq-specific
 * patterns that break Mermaid parsing BEFORE sending to the renderer.
 *
 * This catches issues that LLMs produce even when instructed not to,
 * because they copy Logseq markup from the RAG context into Mermaid code.
 *
 * Strategy: be conservative. Only fix patterns that are clearly Logseq
 * artifacts and would definitely cause parse errors. Don't try to
 * restructure the diagram or add style lines.
 */

/**
 * Sanitize mermaid code by removing Logseq-specific markup patterns
 * that cause parse errors like "Expecting 'SPACELINE', got 'NODE_DSTART'".
 *
 * Returns the sanitized code (may be unchanged if no issues found).
 */
export function sanitizeMermaidCode(code: string): string {
  let result = code;

  // Fix: [#hexcolor](logseq://...) → remove entirely (the color was embedded as a link)
  // e.g., "fill:[#1f8ef1](logseq://page/1f8ef1)" → "fill:#1f8ef1"
  // But only when preceded by fill: or stroke: or similar CSS-like property
  result = result.replace(/(\b(?:fill|stroke|color|background):\s*)\[#([0-9a-fA-F]{3,8})\]\([^)]*\)/g, '$1#$2');

  // Fix: standalone [#hexcolor](logseq://...) NOT preceded by a CSS property
  // Just remove it entirely — it's Logseq link noise inside a label
  result = result.replace(/\[#[0-9a-fA-F]{3,8}\]\([^)]*\)/g, '');

  // Fix: [text](logseq://...) → just the text (strip the link wrapper)
  result = result.replace(/\[([^\]]*)\]\(logseq:\/\/[^)]*\)/g, '$1');

  // Fix: [[page name]] → page name (strip Logseq page link brackets)
  // But preserve Mermaid's own [[...]] syntax (stadium-shaped nodes)
  // Mermaid stadium nodes: A[[text]] — always preceded by a node ID
  // Logseq page links: typically appear mid-text without a preceding node ID pattern
  result = result.replace(/\[\[([^\]]+)\]\]/g, (match, content, offset) => {
    // Check if preceded by a node ID pattern (word chars immediately before)
    const before = result.slice(Math.max(0, offset - 30), offset);
    // If the [[ is immediately preceded by a word char (nodeId[[ pattern), it's Mermaid syntax
    if (/\w$/.test(before)) {
      return match;
    }
    return content;
  });

  // Clean up any resulting empty brackets or double-spaces
  result = result.replace(/\[\s*\]/g, '');
  result = result.replace(/  +/g, ' ');

  // Remove empty lines that may have been created by stripping
  result = result.replace(/\n\s*\n\s*\n/g, '\n\n');

  return result;
}
