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

  // Clean up any resulting empty brackets or double-spaces (but preserve leading indentation)
  result = result.replace(/\[\s*\]/g, '');
  result = result.replace(/(\S)  +/g, '$1 ');

  // Remove empty lines that may have been created by stripping
  result = result.replace(/\n\s*\n\s*\n/g, '\n\n');

  // Strip emoji characters that cause Mermaid's internal renderer to crash
  // with "Cannot read properties of null (reading 'replace')" errors.
  // Mermaid's text parsing cannot handle Unicode emoji in node labels.
  result = result.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}]\s*/gu, '');

  // Fix mindmap-specific issues
  result = fixMindmapStructure(result);

  return result;
}

/**
 * Fix mindmap-specific structural issues:
 * - Remove standalone "style" or "classDef" lines (mindmaps interpret them as nodes)
 * - Fix indentation: ensure all non-root nodes are indented deeper than root
 */
function fixMindmapStructure(code: string): string {
  const lines = code.split('\n');
  
  // Detect if this is a mindmap
  const firstContentLine = lines.find(l => l.trim().length > 0);
  if (!firstContentLine || !firstContentLine.trim().startsWith('mindmap')) {
    return code;
  }

  // Find the root node and its indentation
  let rootLineIndex = -1;
  let rootIndent = -1;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === 'mindmap' || trimmed === '') continue;
    // First non-mindmap, non-empty line is the root
    rootLineIndex = i;
    rootIndent = lines[i].search(/\S/);
    break;
  }

  if (rootLineIndex === -1 || rootIndent === -1) return code;

  let modified = false;
  const result: string[] = [];
  const childIndent = rootIndent + 2; // minimum indent for root's children

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Keep empty lines, mindmap declaration, and root line as-is
    if (i <= rootLineIndex || trimmed === '') {
      result.push(line);
      continue;
    }

    // Remove standalone style/classDef lines in mindmaps
    if (/^\s*(style|classDef)\b/.test(line)) {
      modified = true;
      continue; // skip this line entirely
    }

    // Check indentation
    const currentIndent = line.search(/\S/);
    if (currentIndent >= 0 && currentIndent <= rootIndent) {
      // This node is at root level or less — push it to be a child of root
      // Add extra indent: shift by (childIndent - currentIndent)
      const shift = childIndent - currentIndent;
      const fixedLine = ' '.repeat(currentIndent + shift) + trimmed;
      result.push(fixedLine);
      modified = true;
    } else {
      result.push(line);
    }
  }

  return modified ? result.join('\n') : code;
}
