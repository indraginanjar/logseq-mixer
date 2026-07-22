/**
 * SkillStore — data layer for Agent Skills stored as Logseq pages.
 * Skills live under the Mixer/Skills/ namespace.
 */

export interface SkillEntry {
  name: string;            // skill name (lowercase, hyphens only) e.g. 'pdf-processing'
  description: string;     // what the skill does and when to use it (max 1024 chars)
  enabled: boolean;        // whether this skill is active in the catalog
  body: string;            // full instruction content (markdown)
  source?: string;         // where it came from e.g. 'github:user/repo/path'
  license?: string;        // license info
  version?: string;        // version string
  metadata?: Record<string, string>; // arbitrary key-value pairs
  pageName: string;        // full Logseq page name e.g. 'Mixer/Skills/pdf-processing'
}

export type SkillCatalogEntry = Pick<SkillEntry, 'name' | 'description'>;

const SKILLS_NAMESPACE = 'Mixer/Skills';

/**
 * Load all skills from Logseq pages under Mixer/Skills/.
 */
export async function loadAllSkills(): Promise<SkillEntry[]> {
  const allPages = (await logseq.Editor.getAllPages()) ?? [];
  const skillPages = allPages.filter(
    (p: any) => p.name?.toLowerCase().startsWith(SKILLS_NAMESPACE.toLowerCase() + '/')
  );

  const skills: SkillEntry[] = [];
  for (const page of skillPages) {
    try {
      const skill = await loadSkillFromPage(page);
      if (skill) skills.push(skill);
    } catch (err) {
      console.warn(`[SkillStore] Failed to load skill page: ${page.name}`, err);
    }
  }
  return skills;
}

/**
 * Load a single skill from a Logseq page object.
 */
async function loadSkillFromPage(page: any): Promise<SkillEntry | null> {
  const blocks = await logseq.Editor.getPageBlocksTree(page.uuid ?? page.name);
  if (!blocks || blocks.length === 0) return null;

  // First block typically contains properties
  const propsBlock = blocks[0];
  const properties = propsBlock.properties ?? {};

  const name = properties.name ?? extractNameFromPageName(page.name);
  const description = properties.description ?? '';
  if (!description) return null; // description is required per spec

  const enabled = properties.enabled !== 'false' && properties.enabled !== false;

  // Body content: all blocks after the properties block, or child blocks
  const bodyLines: string[] = [];
  const bodyBlocks: any[] = (propsBlock.children as any[])?.length > 0 ? (propsBlock.children as any[]) : blocks.slice(1);
  collectBlockContent(bodyBlocks, bodyLines, 0);

  return {
    name,
    description,
    enabled,
    body: bodyLines.join('\n'),
    source: properties.source ?? undefined,
    license: properties.license ?? undefined,
    version: properties.version ?? undefined,
    metadata: properties.metadata ? tryParseJson(properties.metadata) : undefined,
    pageName: page.name,
  };
}

/**
 * Recursively collect block content into lines with indentation.
 */
function collectBlockContent(blocks: any[], lines: string[], depth: number): void {
  if (!blocks) return;
  for (const block of blocks) {
    if (block.content) {
      // Skip property blocks (contain ::)
      const trimmed = block.content.trim();
      if (trimmed.includes('::') && !trimmed.includes('\n')) continue;
      const indent = '  '.repeat(depth);
      lines.push(indent + trimmed);
    }
    if (block.children?.length > 0) {
      collectBlockContent(block.children, lines, depth + 1);
    }
  }
}

/**
 * Extract skill name from page name (e.g. 'Mixer/Skills/pdf-processing' → 'pdf-processing')
 */
function extractNameFromPageName(pageName: string): string {
  const parts = pageName.split('/');
  return parts[parts.length - 1].toLowerCase();
}

function tryParseJson(value: string): Record<string, string> | undefined {
  try { return JSON.parse(value); } catch { return undefined; }
}

/**
 * Get the catalog of enabled skills (name + description only).
 */
export async function getSkillCatalog(): Promise<SkillCatalogEntry[]> {
  const skills = await loadAllSkills();
  return skills
    .filter(s => s.enabled)
    .map(s => ({ name: s.name, description: s.description }));
}

/**
 * Get the full instruction body of a skill by name.
 */
export async function getSkillBody(name: string): Promise<string | null> {
  const skills = await loadAllSkills();
  const skill = skills.find(s => s.name === name);
  return skill?.body ?? null;
}

/**
 * Save a skill to a Logseq page. Creates or updates the page.
 */
export async function saveSkill(skill: Omit<SkillEntry, 'pageName'> & { pageName?: string }): Promise<string> {
  const pageName = skill.pageName ?? `${SKILLS_NAMESPACE}/${skill.name}`;

  // Check if page exists
  let page = await logseq.Editor.getPage(pageName);
  if (!page) {
    page = await logseq.Editor.createPage(pageName, {}, { journal: false, redirect: false });
  }

  const blocks = await logseq.Editor.getPageBlocksTree(pageName);
  if (!blocks || blocks.length === 0) return pageName;

  // Build properties string
  const propsLines: string[] = [
    `name:: ${skill.name}`,
    `description:: ${skill.description}`,
    `enabled:: ${skill.enabled}`,
  ];
  if (skill.source) propsLines.push(`source:: ${skill.source}`);
  if (skill.license) propsLines.push(`license:: ${skill.license}`);
  if (skill.version) propsLines.push(`version:: ${skill.version}`);
  if (skill.metadata) propsLines.push(`metadata:: ${JSON.stringify(skill.metadata)}`);

  // Update first block with properties
  await logseq.Editor.updateBlock(blocks[0].uuid, propsLines.join('\n'));

  // Remove existing child blocks (to replace body)
  if (blocks[0].children) {
    for (const child of (blocks[0].children as any[])) {
      await logseq.Editor.removeBlock(child.uuid);
    }
  }
  // Remove sibling blocks after the first (old body content)
  for (let i = blocks.length - 1; i > 0; i--) {
    await logseq.Editor.removeBlock(blocks[i].uuid);
  }

  // Insert body content as child blocks of the first block
  const bodyLines = skill.body.split('\n').filter(l => l.trim());
  for (const line of bodyLines) {
    await logseq.Editor.insertBlock(blocks[0].uuid, line.trim(), { sibling: false });
  }

  return pageName;
}

/**
 * Delete a skill by removing its Logseq page.
 */
export async function deleteSkill(name: string): Promise<boolean> {
  const pageName = `${SKILLS_NAMESPACE}/${name}`;
  try {
    await logseq.Editor.deletePage(pageName);
    return true;
  } catch {
    return false;
  }
}

/**
 * Toggle a skill's enabled state.
 */
export async function toggleSkill(name: string, enabled: boolean): Promise<void> {
  const pageName = `${SKILLS_NAMESPACE}/${name}`;
  const blocks = await logseq.Editor.getPageBlocksTree(pageName);
  if (!blocks || blocks.length === 0) return;

  // Update the properties block — find and replace enabled:: line
  const content = blocks[0].content ?? '';
  let newContent: string;
  if (content.includes('enabled::')) {
    newContent = content.replace(/enabled::.*/, `enabled:: ${enabled}`);
  } else {
    newContent = content + `\nenabled:: ${enabled}`;
  }
  await logseq.Editor.updateBlock(blocks[0].uuid, newContent);
}

/**
 * Get a skill entry by name.
 */
export async function getSkill(name: string): Promise<SkillEntry | null> {
  const skills = await loadAllSkills();
  return skills.find(s => s.name === name) ?? null;
}
