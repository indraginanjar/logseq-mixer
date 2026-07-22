/**
 * skillCatalog — builds system prompt injection text for progressive disclosure.
 *
 * Tier 1 (catalog): name + description for all enabled skills, injected at session start.
 * Tier 2 (activation): full skill body loaded when the skill is activated.
 */

import type { SkillCatalogEntry, SkillEntry } from './SkillStore';

/**
 * Build the skill catalog section for the system prompt.
 * Only includes enabled skills. Returns empty string if no skills are available.
 *
 * The catalog tells the LLM what skills exist and how to activate them.
 * Each skill costs ~50-100 tokens in the catalog.
 */
export function buildSkillCatalogPrompt(skills: SkillCatalogEntry[]): string {
  if (skills.length === 0) return '';

  const lines: string[] = [
    '',
    '## Available Skills',
    'The following skills provide specialized instructions for specific tasks.',
    'When a task matches a skill\'s description, call the `activate_skill` tool with the skill name to load its full instructions.',
    'The user can also activate a skill with `/skill <name>` in chat.',
    '',
  ];

  for (const skill of skills) {
    lines.push(`- **${skill.name}**: ${skill.description}`);
  }

  return lines.join('\n');
}

/**
 * Build the activation context when a skill is loaded into the conversation.
 * Wraps the skill body in structured markers so it can be identified in context
 * and protected from compaction.
 */
export function buildSkillActivationContext(skill: SkillEntry): string {
  const lines: string[] = [
    `<skill_content name="${skill.name}">`,
    '',
    skill.body,
    '',
    '</skill_content>',
  ];

  return lines.join('\n');
}

/**
 * Build a compact summary of which skills are currently activated in the session.
 * Used for deduplication and status display.
 */
export function buildActivatedSkillsSummary(activatedNames: string[]): string {
  if (activatedNames.length === 0) return '';
  return `\n[Active skills: ${activatedNames.join(', ')}]`;
}
