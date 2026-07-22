/**
 * Logseq Editor APIs exposed as OpenAI-compatible tool definitions
 * for use in the ReAct loop alongside MCP tools.
 */

import { activateSkill } from '../manager';
import { importFromGitHub } from '../skills/skillImporter';
import { blockContentToSkill } from '../skills/skillParser';
import { saveSkill } from '../skills/SkillStore';

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
 * Skill-related tool definitions for the ReAct loop.
 * These allow the LLM to activate skills, import from GitHub, and create from blocks.
 */
export const SKILL_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'activate_skill',
      description: 'Activate a skill to load its full specialized instructions into context. Use when a task matches a skill description from the Available Skills catalog. Returns the skill instructions.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The skill name (from the Available Skills catalog)' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'mixer_import_skill',
      description: 'Import a skill from a GitHub URL. The URL should point to a SKILL.md file or a directory containing one. The skill will be saved as a Logseq page under Mixer/Skills/.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'GitHub URL to the skill (repo, directory, or SKILL.md file)' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'mixer_create_skill',
      description: 'Create a new skill from a Logseq block. Reads the block content and saves it as a skill page under Mixer/Skills/.',
      parameters: {
        type: 'object',
        properties: {
          blockUUID: { type: 'string', description: 'UUID of the Logseq block to convert into a skill' },
          name: { type: 'string', description: 'Skill name (lowercase, hyphens, 1-64 chars)' },
          description: { type: 'string', description: 'What the skill does and when to use it (max 1024 chars)' },
        },
        required: ['blockUUID', 'name', 'description'],
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
    case 'activate_skill': {
      const context = await activateSkill(args.name);
      if (!context) return `Skill "${args.name}" not found, disabled, or already activated in this session.`;
      return context;
    }
    case 'mixer_import_skill': {
      const result = await importFromGitHub(args.url);
      if (!result.success || !result.skill) return `Failed to import skill: ${result.error}`;
      await saveSkill(result.skill);
      return `✅ Skill "${result.skill.name}" imported successfully.\nDescription: ${result.skill.description}\nPage: ${result.skill.pageName}`;
    }
    case 'mixer_create_skill': {
      const block = await logseq.Editor.getBlock(args.blockUUID);
      if (!block) return `Block "${args.blockUUID}" not found.`;
      // Collect block content including children
      let content = block.content || '';
      if (block.children?.length) {
        const childBlocks = await logseq.Editor.getPageBlocksTree(block.uuid);
        // childBlocks is the block itself with children — extract text
        const lines: string[] = [content];
        const collectChildren = (children: any[]) => {
          for (const child of children) {
            if (child.content) lines.push(child.content);
            if (child.children?.length) collectChildren(child.children);
          }
        };
        if (childBlocks?.[0]?.children) collectChildren(childBlocks[0].children);
        content = lines.join('\n');
      }
      const skill = blockContentToSkill(content, args.name, args.description);
      if (!skill) return `Failed to create skill: invalid name or empty content.`;
      await saveSkill(skill);
      return `✅ Skill "${skill.name}" created from block.\nDescription: ${skill.description}\nPage: ${skill.pageName}`;
    }
    default:
      return `Unknown Logseq tool: ${name}`;
  }
}
