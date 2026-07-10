/**
 * Logseq Editor APIs exposed as OpenAI-compatible tool definitions
 * for use in the ReAct loop alongside MCP tools.
 */

export const LOGSEQ_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'logseq_get_page',
      description: 'Get a Logseq page by name. Returns page metadata (name, uuid, id).',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Page name to look up' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'logseq_get_blocks',
      description: 'Get the block tree of a Logseq page. Returns hierarchical block content formatted as an indented tree. IMPORTANT: Indentation represents parent-child nesting (sub-blocks). Each level of indentation (2 spaces) means the block is a child (sub-block) of the nearest block above it with less indentation. For example:\n- [uuid1] Parent block\n  - [uuid2] Sub-block of uuid1\n    - [uuid3] Sub-block of uuid2 (grandchild of uuid1)\n  - [uuid4] Another sub-block of uuid1\nTo find sub-blocks of a specific block, look for all blocks indented one level deeper directly beneath it.',
      parameters: {
        type: 'object',
        properties: {
          page: { type: 'string', description: 'Page name or UUID' },
        },
        required: ['page'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'logseq_search_pages',
      description: 'Search for pages by name substring match. Returns list of matching page names.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query to match against page names' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'logseq_insert_block',
      description: 'Insert a new block. If parentBlockUUID is provided, inserts as a child of that block. If omitted, inserts into the current page or auto-creates a new page. Always call this directly — do NOT ask the user for a target.',
      parameters: {
        type: 'object',
        properties: {
          parentBlockUUID: { type: 'string', description: 'UUID of the parent block or page. Optional — if omitted, uses current page or creates a new page automatically.' },
          content: { type: 'string', description: 'Block content to insert' },
        },
        required: ['content'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'logseq_update_block',
      description: 'Update the content of an existing block.',
      parameters: {
        type: 'object',
        properties: {
          blockUUID: { type: 'string', description: 'UUID of the block to update' },
          content: { type: 'string', description: 'New block content' },
        },
        required: ['blockUUID', 'content'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'logseq_create_page',
      description: 'Create a new Logseq page. Returns the page name and UUID.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name for the new page' },
        },
        required: ['name'],
      },
    },
  },
];

/**
 * Execute a Logseq tool call by name and arguments.
 */
export async function executeLogseqTool(name: string, args: any): Promise<string> {
  switch (name) {
    case 'logseq_get_page': {
      const page = await logseq.Editor.getPage(args.name);
      if (!page) return `Page "${args.name}" not found.`;
      return JSON.stringify({ name: page.name, uuid: page.uuid, id: page.id });
    }
    case 'logseq_get_blocks': {
      const blocks = await logseq.Editor.getPageBlocksTree(args.page);
      if (!blocks || blocks.length === 0) return `No blocks found for page "${args.page}".`;
      const format = (b: any, depth = 0): string => {
        const indent = '  '.repeat(depth);
        let text = `${indent}- [${b.uuid}] ${b.content}\n`;
        if (b.children) {
          for (const child of b.children) text += format(child, depth + 1);
        }
        return text;
      };
      const header = `Block tree for "${args.page}" (each indentation level = sub-block/child of the parent above):\n`;
      return header + blocks.map((b: any) => format(b)).join('');
    }
    case 'logseq_search_pages': {
      const pages = await logseq.Editor.getAllPages();
      const query = (args.query || '').toLowerCase();
      const matches = (pages || [])
        .filter((p: any) => p.name?.toLowerCase().includes(query))
        .slice(0, 20)
        .map((p: any) => p.name);
      return matches.length > 0 ? matches.join('\n') : `No pages matching "${args.query}".`;
    }
    case 'logseq_insert_block': {
      let parentUUID = args.parentBlockUUID;
      // If no parent provided, auto-create a page and use it as parent
      if (!parentUUID) {
        let page = await logseq.Editor.getCurrentPage();
        if (!page) {
          const currentBlock = await logseq.Editor.getCurrentBlock();
          if (currentBlock?.page) page = await logseq.Editor.getPage(currentBlock.page.id);
        }
        // Exclude internal Mixer pages
        const pName = page ? String((page as any).name || '') : '';
        if (page && (pName.startsWith('Mixer/') || pName.startsWith('mixer/'))) {
          page = null;
        }
        if (page) {
          parentUUID = (page as any).uuid;
        } else {
          // No page open — create one
          const newPage = await logseq.Editor.createPage('Mixer Notes', {}, { journal: false, redirect: false });
          if (!newPage) return 'Failed to insert block: no page open and could not create one.';
          parentUUID = newPage.uuid;
        }
      }
      const block = await logseq.Editor.insertBlock(parentUUID, args.content, { sibling: false });
      if (!block) return 'Failed to insert block.';
      return `Inserted block: ${block.uuid}`;
    }
    case 'logseq_update_block': {
      await logseq.Editor.updateBlock(args.blockUUID, args.content);
      return `Updated block: ${args.blockUUID}`;
    }
    case 'logseq_create_page': {
      const page = await logseq.Editor.createPage(args.name, {}, { journal: false, redirect: false });
      if (!page) return `Failed to create page "${args.name}".`;
      return JSON.stringify({ name: page.name, uuid: page.uuid });
    }
    default:
      return `Unknown Logseq tool: ${name}`;
  }
}
