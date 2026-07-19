export async function writeMemoryPage(content: string, category: string): Promise<void> {
  try {
    if (category === 'session_summary') {
      const now = new Date();
      const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
      const pageName = `Mixer/Memory/Session-${stamp}`;
      await logseq.Editor.createPage(pageName, {}, { journal: false, redirect: false });
      const blocks = await logseq.Editor.getPageBlocksTree(pageName);
      if (blocks && blocks.length > 0) {
        await logseq.Editor.updateBlock(blocks[0].uuid, `type:: mixer-memory\ncategory:: ${category}\ncreated:: ${stamp}`);
        // Split content into individual lines and insert each as a child block
        // to avoid Logseq's "multiple unordered lists in a block" warning
        const lines = splitIntoBlocks(content);
        let parentUuid = blocks[0].uuid;
        for (const line of lines) {
          if (line.trim()) {
            const inserted = await logseq.Editor.insertBlock(parentUuid, line, { sibling: false });
            if (inserted && lines.indexOf(line) === 0) {
              // First block inserted, subsequent ones are siblings of it
              parentUuid = blocks[0].uuid;
            }
          }
        }
      }
    } else {
      const pageName = category === 'preference' ? 'Mixer/Memory/Preferences' : 'Mixer/Memory/Facts';
      let page = await logseq.Editor.getPage(pageName);
      if (!page) {
        page = await logseq.Editor.createPage(pageName, {}, { journal: false, redirect: false });
      }
      const blocks = await logseq.Editor.getPageBlocksTree(pageName);
      if (blocks && blocks.length > 0) {
        // Split content into individual lines for clean block structure
        const lines = splitIntoBlocks(content);
        for (const line of lines) {
          if (line.trim()) {
            await logseq.Editor.insertBlock(blocks[0].uuid, line, { sibling: true });
          }
        }
      }
    }
  } catch (err) {
    console.error('[writeMemoryPage] Failed:', err);
  }
}

/**
 * Split LLM-generated summary content into individual block-safe lines.
 * Handles markdown bullet points, numbered lists, and headings — each
 * becomes its own block so Logseq doesn't show the "multiple unordered
 * lists" warning.
 */
function splitIntoBlocks(content: string): string[] {
  const lines = content.split('\n');
  const blocks: string[] = [];
  let currentBlock = '';

  for (const line of lines) {
    const trimmed = line.trim();
    // Start a new block on list items, headings, or blank lines
    if (/^[-*+]\s/.test(trimmed) || /^\d+[.)]\s/.test(trimmed) || /^#{1,6}\s/.test(trimmed)) {
      if (currentBlock.trim()) {
        blocks.push(currentBlock.trim());
      }
      // Strip the leading bullet marker for cleaner Logseq blocks
      // (Logseq already renders each block as a bullet)
      currentBlock = trimmed.replace(/^[-*+]\s+/, '').replace(/^\d+[.)]\s+/, '');
    } else if (trimmed === '') {
      if (currentBlock.trim()) {
        blocks.push(currentBlock.trim());
        currentBlock = '';
      }
    } else {
      // Continuation line — append to current block
      currentBlock += (currentBlock ? ' ' : '') + trimmed;
    }
  }

  if (currentBlock.trim()) {
    blocks.push(currentBlock.trim());
  }

  return blocks.length > 0 ? blocks : [content.trim()];
}
