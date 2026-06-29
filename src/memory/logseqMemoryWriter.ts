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
        await logseq.Editor.insertBlock(blocks[0].uuid, content, { sibling: false });
      }
    } else {
      const pageName = category === 'preference' ? 'Mixer/Memory/Preferences' : 'Mixer/Memory/Facts';
      let page = await logseq.Editor.getPage(pageName);
      if (!page) {
        page = await logseq.Editor.createPage(pageName, {}, { journal: false, redirect: false });
      }
      const blocks = await logseq.Editor.getPageBlocksTree(pageName);
      if (blocks && blocks.length > 0) {
        await logseq.Editor.insertBlock(blocks[0].uuid, content, { sibling: true });
      }
    }
  } catch (err) {
    console.error('[writeMemoryPage] Failed:', err);
  }
}
