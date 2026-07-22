/**
 * skillParser — parse SKILL.md format and convert between Logseq page format.
 * Follows the agentskills.io specification for SKILL.md parsing.
 */

import type { SkillEntry } from './SkillStore';

/** Validation result for skill names */
export interface NameValidation {
  valid: boolean;
  error?: string;
}

/**
 * Validate a skill name according to the agentskills.io spec:
 * - 1-64 characters
 * - Only lowercase alphanumeric and hyphens
 * - Must not start or end with a hyphen
 * - Must not contain consecutive hyphens
 */
export function validateSkillName(name: string): NameValidation {
  if (!name || name.length === 0) return { valid: false, error: 'Name is required' };
  if (name.length > 64) return { valid: false, error: 'Name must be 64 characters or less' };
  if (!/^[a-z0-9-]+$/.test(name)) return { valid: false, error: 'Name must contain only lowercase letters, numbers, and hyphens' };
  if (name.startsWith('-') || name.endsWith('-')) return { valid: false, error: 'Name must not start or end with a hyphen' };
  if (name.includes('--')) return { valid: false, error: 'Name must not contain consecutive hyphens' };
  return { valid: true };
}

/**
 * Parse a SKILL.md file content into a SkillEntry.
 * Handles YAML frontmatter between --- delimiters.
 * Uses lenient parsing: warns on issues but loads when possible.
 */
export function parseSkillMd(content: string): SkillEntry | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith('---')) {
    // No frontmatter — treat entire content as body, cannot extract metadata
    return null;
  }

  // Find closing ---
  const secondDelimiter = trimmed.indexOf('---', 3);
  if (secondDelimiter === -1) return null;

  const yamlBlock = trimmed.slice(3, secondDelimiter).trim();
  const body = trimmed.slice(secondDelimiter + 3).trim();

  // Parse YAML (simple key: value parser, handles common cases)
  const frontmatter = parseSimpleYaml(yamlBlock);
  if (!frontmatter) return null;

  const name = frontmatter.name;
  const description = frontmatter.description;

  if (!name || !description) return null; // Both required

  // Parse metadata if present (nested YAML)
  let metadata: Record<string, string> | undefined;
  if (frontmatter._metadata_raw) {
    metadata = parseNestedYaml(frontmatter._metadata_raw);
  }

  return {
    name,
    description,
    enabled: true, // newly imported skills are enabled by default
    body,
    license: frontmatter.license ?? undefined,
    version: frontmatter.version ?? frontmatter['metadata.version'] ?? undefined,
    metadata,
    pageName: `Mixer/Skills/${name}`,
    source: undefined, // caller sets this
  };
}

/**
 * Simple YAML parser for frontmatter.
 * Handles basic key: value pairs and detects nested blocks (metadata).
 * Lenient: handles unquoted values with colons.
 */
function parseSimpleYaml(yaml: string): Record<string, string> & { _metadata_raw?: string } | null {
  const result: Record<string, string> & { _metadata_raw?: string } = {};
  const lines = yaml.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      i++;
      continue;
    }

    // Check for key: value pattern
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) {
      i++;
      continue;
    }

    const key = trimmed.slice(0, colonIdx).trim();
    let value = trimmed.slice(colonIdx + 1).trim();

    // Handle nested block (like metadata:)
    if (!value && i + 1 < lines.length && lines[i + 1].startsWith('  ')) {
      const nestedLines: string[] = [];
      i++;
      while (i < lines.length && (lines[i].startsWith('  ') || lines[i].trim() === '')) {
        nestedLines.push(lines[i]);
        i++;
      }
      if (key === 'metadata') {
        result._metadata_raw = nestedLines.join('\n');
      }
      continue;
    }

    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    result[key] = value;
    i++;
  }

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Parse nested YAML (indented key: value pairs) into a flat map.
 */
function parseNestedYaml(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    let value = trimmed.slice(colonIdx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) result[key] = value;
  }
  return Object.keys(result).length > 0 ? result : {};
}

/**
 * Convert a SkillEntry to Logseq page block structure.
 * Returns the properties text and body lines for writing to a page.
 */
export function skillToLogseqBlocks(skill: SkillEntry): { properties: string; bodyLines: string[] } {
  const propsLines: string[] = [
    `name:: ${skill.name}`,
    `description:: ${skill.description}`,
    `enabled:: ${skill.enabled}`,
  ];
  if (skill.source) propsLines.push(`source:: ${skill.source}`);
  if (skill.license) propsLines.push(`license:: ${skill.license}`);
  if (skill.version) propsLines.push(`version:: ${skill.version}`);
  if (skill.metadata && Object.keys(skill.metadata).length > 0) {
    propsLines.push(`metadata:: ${JSON.stringify(skill.metadata)}`);
  }

  const bodyLines = skill.body.split('\n').filter(l => l.trim());

  return { properties: propsLines.join('\n'), bodyLines };
}

/**
 * Convert a Logseq block's text content into a SkillEntry.
 * The user provides the name and optionally a description.
 * The block content becomes the skill's instruction body.
 */
export function blockContentToSkill(
  blockContent: string,
  name: string,
  description?: string
): SkillEntry | null {
  const validation = validateSkillName(name);
  if (!validation.valid) return null;

  const body = blockContent.trim();
  if (!body) return null;

  // If no description provided, use first line or a truncated version
  const desc = description || generateDescriptionFromBody(body);

  return {
    name,
    description: desc,
    enabled: true,
    body,
    pageName: `Mixer/Skills/${name}`,
  };
}

/**
 * Generate a description from the body content (first meaningful line, truncated).
 */
function generateDescriptionFromBody(body: string): string {
  const lines = body.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
  const firstLine = lines[0] ?? 'Custom skill';
  return firstLine.length > 200 ? firstLine.slice(0, 197) + '...' : firstLine;
}

/**
 * Convert a SkillEntry back to SKILL.md format (for export).
 */
export function skillToSkillMd(skill: SkillEntry): string {
  const frontmatterLines: string[] = [
    '---',
    `name: ${skill.name}`,
    `description: ${skill.description}`,
  ];
  if (skill.license) frontmatterLines.push(`license: ${skill.license}`);
  if (skill.metadata && Object.keys(skill.metadata).length > 0) {
    frontmatterLines.push('metadata:');
    for (const [k, v] of Object.entries(skill.metadata)) {
      frontmatterLines.push(`  ${k}: "${v}"`);
    }
  }
  frontmatterLines.push('---');

  return frontmatterLines.join('\n') + '\n\n' + skill.body;
}
