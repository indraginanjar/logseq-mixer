/**
 * BlockTreeFormatter — formats the active page's block tree into
 * indented text with UUIDs so the LLM can reference specific blocks.
 */

export interface BlockNode {
  uuid: string;
  content: string;
  children: BlockNode[];
}

/**
 * Format a block tree into indented text with UUIDs for LLM context.
 * Each line: `  [uuid:abc-123] - Block content here`
 * Indentation increases by 2 spaces per nesting level.
 */
export function formatBlockTree(blocks: BlockNode[], indentLevel: number = 0): string {
  const lines: string[] = [];
  const indent = ' '.repeat(indentLevel * 2);

  for (const block of blocks) {
    lines.push(`${indent}[uuid:${block.uuid}] - ${block.content}`);
    if (block.children && block.children.length > 0) {
      lines.push(formatBlockTree(block.children, indentLevel + 1));
    }
  }

  return lines.join('\n');
}

/**
 * Map a Logseq block (from getPageBlocksTree) to our BlockNode interface.
 * Logseq blocks have `uuid`, `content`, and `children` properties.
 */
function mapToBlockNodes(logseqBlocks: any[]): BlockNode[] {
  return logseqBlocks.map((b) => ({
    uuid: b.uuid,
    content: b.content ?? '',
    children: b.children ? mapToBlockNodes(b.children) : [],
  }));
}

/**
 * Recursively count all blocks in a tree.
 */
function countBlocks(blocks: BlockNode[]): number {
  let count = 0;
  for (const block of blocks) {
    count += 1;
    if (block.children && block.children.length > 0) {
      count += countBlocks(block.children);
    }
  }
  return count;
}

/**
 * Fetch and format the current page's block tree.
 * Returns null if no page is open or on error.
 */
export async function getActivePageContext(): Promise<{
  pageName: string;
  pageUUID: string;
  formattedTree: string;
  blockCount: number;
  selectedBlockUUID: string | null;
  selectedBlockContent: string | null;
  isSelectedBlockEmpty: boolean;
  isBlockView: boolean;
} | null> {
  try {
    let page = await logseq.Editor.getCurrentPage();
    const currentBlock = await logseq.Editor.getCurrentBlock();

    // Check if we're in a zoomed-in block view (block as virtual page)
    // In Logseq, when a user zooms into a block, getCurrentPage() returns
    // an object with `page` property but the view is scoped to that block.
    // We detect this by checking if the "page" has a `uuid` that matches a block.
    let isBlockView = false;
    let rootBlock: any = null;

    if (page && (page as any)['block/uuid']) {
      // This is a block being viewed as a page (zoomed-in view)
      isBlockView = true;
      rootBlock = await logseq.Editor.getBlock((page as any).uuid || (page as any)['block/uuid'], { includeChildren: true });
      // Get the actual parent page
      if (rootBlock?.page) {
        page = await logseq.Editor.getPage(rootBlock.page.id);
      }
    } else if (page === null && currentBlock && currentBlock.page) {
      page = await logseq.Editor.getPage(currentBlock.page.id);
      // On journal home view, scope context to the focused block's tree
      // rather than the full journal page (which may have many unrelated entries)
      if (page && !rootBlock) {
        rootBlock = await logseq.Editor.getBlock(currentBlock.uuid, { includeChildren: true });
        if (rootBlock) {
          isBlockView = true;
        }
      }
    }

    if (page === null) {
      return null;
    }

    const pageName: string = String(page.name ?? page.originalName ?? '');
    const pageUUID: string = String(page.uuid ?? '');
    const selectedBlockUUID = currentBlock ? String(currentBlock.uuid) : null;
    const selectedBlockContent = currentBlock ? String(currentBlock.content ?? '') : null;
    const isSelectedBlockEmpty = currentBlock ? !currentBlock.content?.trim() : false;

    let rawBlocks: any[];
    if (isBlockView && rootBlock) {
      // Use the zoomed-in block and its children as the tree
      rawBlocks = [rootBlock];
    } else {
      rawBlocks = await logseq.Editor.getPageBlocksTree(pageName) ?? [];
    }

    const blockNodes = mapToBlockNodes(rawBlocks);
    const formattedTree = formatBlockTree(blockNodes);
    const blockCount = countBlocks(blockNodes);

    return { pageName, pageUUID, formattedTree, blockCount, selectedBlockUUID, selectedBlockContent, isSelectedBlockEmpty, isBlockView };
  } catch (err) {
    console.error('Failed to get active page context:', err);
    return null;
  }
}
