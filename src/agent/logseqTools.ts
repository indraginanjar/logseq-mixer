/**
 * Logseq Editor APIs exposed as OpenAI-compatible tool definitions
 * for use in the ReAct loop alongside MCP tools.
 */

import { activateSkill } from '../manager';
import { importFromGitHub } from '../skills/skillImporter';
import { blockContentToSkill, validateSkillName } from '../skills/skillParser';
import { saveSkill, getSkill } from '../skills/SkillStore';
import { buildSkillActivationContext } from '../skills/skillCatalog';
import { runReActLoop } from './ReActLoop';

/** Module-level settings reference for subtask execution. */
let _subtaskSettings: any = null;

/** Set the settings reference for subtask execution (called from manager.ts or App). */
export function setSubtaskSettings(settings: any): void {
  _subtaskSettings = settings;
}

/** Get settings for subtask execution. */
function getSubtaskSettings(): any {
  return _subtaskSettings;
}

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
  {
    type: 'function' as const,
    function: {
      name: 'handoff_to_agent',
      description: 'Transfer this conversation to another agent. The current conversation ends and the user will interact with the target agent going forward. Use this when the user\'s request is better handled by a different specialized agent.',
      parameters: {
        type: 'object',
        properties: {
          agent_name: {
            type: 'string',
            description: 'Name of the agent to hand off to',
          },
          context: {
            type: 'string',
            description: 'Brief context/summary to pass to the receiving agent about what the user needs',
          },
        },
        required: ['agent_name'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'delegate_to_agent',
      description: 'Delegate a task to another named agent and get its response. The delegated agent runs with its own personality, tools, and memory. Use this when a task is better suited to a specialized agent.',
      parameters: {
        type: 'object',
        properties: {
          agent_name: {
            type: 'string',
            description: 'Name of the agent to delegate to (e.g., "Researcher", "Coder")',
          },
          task: {
            type: 'string',
            description: 'The task or question to send to the target agent',
          },
        },
        required: ['agent_name', 'task'],
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
      description: 'Create a new skill and save it as a Logseq page under Mixer/Skills/. Use this when the user asks to "create a skill", "make a skill", or "save as a skill". The name will be auto-normalized (lowercased, spaces become hyphens). Provide a body with the skill instructions, OR a blockUUID to use existing block content.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Skill name (lowercase, hyphens, 1-64 chars)' },
          description: { type: 'string', description: 'What the skill does and when to use it (max 1024 chars)' },
          body: { type: 'string', description: 'The full skill instructions (markdown). Use this to create a skill from scratch without a block.' },
          blockUUID: { type: 'string', description: 'UUID of a Logseq block to convert into a skill. If provided, the block content becomes the skill body (body parameter is ignored).' },
        },
        required: ['name', 'description'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'mixer_run_subtask',
      description: 'Delegate a focused subtask to a subagent that runs in an isolated context. The subagent has access to all Logseq tools and MCP tools but has its own conversation history. Use for complex sub-tasks that benefit from a fresh, focused context (e.g., research gathering, analysis, content generation). Returns the subagent\'s final answer.',
      parameters: {
        type: 'object',
        properties: {
          task: { type: 'string', description: 'Clear description of what the subtask should accomplish. Be specific about expected output format.' },
          skill: { type: 'string', description: 'Optional: name of a skill to activate in the subagent context for specialized instructions.' },
          maxIterations: { type: 'number', description: 'Optional: max tool call iterations for the subtask (default: 15).' },
        },
        required: ['task'],
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
      // Auto-normalize name: lowercase, replace spaces/underscores with hyphens, strip invalid chars
      let skillName = (args.name || '').toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-{2,}/g, '-').replace(/^-|-$/g, '');
      if (!skillName) return 'Failed to create skill: name is required.';
      if (skillName.length > 64) skillName = skillName.slice(0, 64).replace(/-$/, '');

      const nameValidation = validateSkillName(skillName);
      if (!nameValidation.valid) return `Failed to create skill: ${nameValidation.error}`;
      if (!args.description?.trim()) return 'Failed to create skill: description is required.';

      let content: string;

      if (args.blockUUID) {
        // Create from block
        const block = await logseq.Editor.getBlock(args.blockUUID);
        if (!block) return `Block "${args.blockUUID}" not found.`;
        content = block.content || '';
        if (block.children?.length) {
          const childBlocks = await logseq.Editor.getPageBlocksTree(block.uuid);
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
      } else if (args.body?.trim()) {
        // Create from provided body
        content = args.body.trim();
      } else {
        return 'Failed to create skill: provide either a blockUUID or a body with instructions.';
      }

      if (!content.trim()) return 'Failed to create skill: content is empty.';

      const skill = blockContentToSkill(content, skillName, args.description);
      if (!skill) return `Failed to create skill: invalid name or empty content.`;
      await saveSkill(skill);
      return `✅ Skill "${skill.name}" created successfully.\nDescription: ${skill.description}\nPage: ${skill.pageName}`;
    }
    case 'mixer_run_subtask': {
      const task = args.task;
      if (!task?.trim()) return 'Failed: task description is required.';

      // Build isolated system prompt for the subagent
      let systemPrompt = 'You are a focused subagent executing a specific subtask. Complete the task thoroughly and return a clear, concise result. Use tools as needed to gather information or perform actions.';

      // Optionally activate a skill in the subagent context
      if (args.skill) {
        const skillEntry = await getSkill(args.skill);
        if (skillEntry?.enabled) {
          systemPrompt += '\n\n' + buildSkillActivationContext(skillEntry);
        }
      }

      const subtaskMessages = [
        { role: 'system' as const, content: systemPrompt },
        { role: 'user' as const, content: task },
      ];

      // Get settings from the parent context (available via closure from executeLogseqTool callers)
      // We need to access settings — use a module-level reference
      const settings = getSubtaskSettings();
      if (!settings) return 'Failed: unable to resolve settings for subtask execution.';

      try {
        const result = await runReActLoop(subtaskMessages, {
          settings,
          maxIterations: args.maxIterations || 15,
          tokenBudget: 0,
          includeLogseqTools: true,
          includeLogseqWriteTools: true,
        });
        const answer = result.answer || '(subtask produced no output)';
        const summary = answer.length > 3000 ? answer.slice(0, 3000) + '\n\n... (truncated)' : answer;
        return `[Subtask completed in ${result.iterations} iterations, ${result.toolCalls.length} tool calls]\n\n${summary}`;
      } catch (err: any) {
        return `Subtask failed: ${err.message || err}`;
      }
    }
    case 'handoff_to_agent': {
      const { agent_name, context: handoffContext } = args;
      if (!agent_name) return 'Error: agent_name is required';

      const { getAgentByName } = await import('../agents/AgentConfigStore');
      const targetAgent = getAgentByName(agent_name);
      if (!targetAgent) return `Error: Agent "${agent_name}" not found.`;

      const { setPendingAgentHandoff } = await import('../manager');
      setPendingAgentHandoff(agent_name, handoffContext || '');

      return `Handing off conversation to ${agent_name}${handoffContext ? ': ' + handoffContext : ''}`;
    }
    case 'delegate_to_agent': {
      const { agent_name, task } = args;
      if (!agent_name || !task) return 'Error: agent_name and task are required';

      const { getAgentByName } = await import('../agents/AgentConfigStore');
      const { resolveSettings } = await import('../agents/resolveAgentSettings');

      const targetAgent = getAgentByName(agent_name);
      if (!targetAgent) return `Error: Agent "${agent_name}" not found. Available agents can be seen in the Agent panel.`;

      // Prevent self-delegation
      const { getActiveAgentId } = await import('../agents/AgentConfigStore');
      if (targetAgent.id === getActiveAgentId()) return 'Error: Cannot delegate to the currently active agent (self-delegation).';

      // Resolve settings for target agent
      const currentSettings = getSubtaskSettings();
      const targetSettings = resolveSettings(currentSettings, targetAgent);

      // Build messages with target agent's system prompt
      const messages = [
        { role: 'system' as const, content: targetAgent.systemPrompt },
        { role: 'user' as const, content: task },
      ];

      try {
        const { runReActLoop } = await import('./ReActLoop');
        const result = await runReActLoop(messages, {
          settings: targetSettings,
          maxIterations: 10,
          tokenBudget: 0,
          tools: [],
          includeLogseqTools: true,
          includeLogseqWriteTools: false,
        });
        return result.answer || '(No response from delegated agent)';
      } catch (err: any) {
        return `Error during delegation: ${err.message}`;
      }
    }
    default:
      return `Unknown Logseq tool: ${name}`;
  }
}
