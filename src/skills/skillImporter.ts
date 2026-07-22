/**
 * skillImporter — fetch and import skills from GitHub URLs.
 * Supports raw URLs, blob URLs, and repo URLs.
 */

import { parseSkillMd } from './skillParser';
import type { SkillEntry } from './SkillStore';

export interface ImportResult {
  success: boolean;
  skill?: SkillEntry;
  error?: string;
}

/**
 * Normalize a GitHub URL to a raw content URL.
 * Handles:
 * - Already raw: https://raw.githubusercontent.com/user/repo/branch/path/SKILL.md
 * - Blob URL: https://github.com/user/repo/blob/branch/path/SKILL.md
 * - Tree URL: https://github.com/user/repo/tree/branch/path
 * - Repo URL: https://github.com/user/repo (tries SKILL.md at root)
 */
export function normalizeGitHubUrl(url: string): string {
  const trimmed = url.trim();

  // Already a raw URL
  if (trimmed.includes('raw.githubusercontent.com')) {
    return trimmed;
  }

  // GitHub blob URL → raw
  // https://github.com/user/repo/blob/main/path/SKILL.md
  const blobMatch = trimmed.match(
    /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/
  );
  if (blobMatch) {
    const [, owner, repo, pathWithBranch] = blobMatch;
    return `https://raw.githubusercontent.com/${owner}/${repo}/${pathWithBranch}`;
  }

  // GitHub tree URL → try SKILL.md in that directory
  // https://github.com/user/repo/tree/main/path
  const treeMatch = trimmed.match(
    /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/(.+)$/
  );
  if (treeMatch) {
    const [, owner, repo, pathWithBranch] = treeMatch;
    return `https://raw.githubusercontent.com/${owner}/${repo}/${pathWithBranch}/SKILL.md`;
  }

  // Plain repo URL → try SKILL.md at root on main branch
  // https://github.com/user/repo
  const repoMatch = trimmed.match(
    /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/?$/
  );
  if (repoMatch) {
    const [, owner, repo] = repoMatch;
    return `https://raw.githubusercontent.com/${owner}/${repo}/main/SKILL.md`;
  }

  // If it looks like a direct URL to a file, use as-is
  return trimmed;
}

/**
 * Determine the source identifier from a GitHub URL.
 * e.g., 'github:user/repo/path/to/skill'
 */
function extractSourceId(url: string): string {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) return `url:${url}`;
  const [, owner, repo] = match;
  // Try to extract path after branch
  const pathMatch = url.match(/(?:blob|tree)\/[^/]+\/(.+?)(?:\/SKILL\.md)?$/);
  const path = pathMatch ? `/${pathMatch[1]}` : '';
  return `github:${owner}/${repo}${path}`;
}

/**
 * Import a skill from a GitHub URL.
 * Fetches the SKILL.md content, parses it, and returns the SkillEntry.
 */
export async function importFromGitHub(url: string): Promise<ImportResult> {
  try {
    const rawUrl = normalizeGitHubUrl(url);

    const response = await fetch(rawUrl);
    if (!response.ok) {
      // If main branch failed, try master
      if (rawUrl.includes('/main/')) {
        const masterUrl = rawUrl.replace('/main/', '/master/');
        const retryResponse = await fetch(masterUrl);
        if (!retryResponse.ok) {
          return { success: false, error: `Failed to fetch: ${response.status} ${response.statusText}` };
        }
        const content = await retryResponse.text();
        return parseAndBuildResult(content, url);
      }
      return { success: false, error: `Failed to fetch: ${response.status} ${response.statusText}` };
    }

    const content = await response.text();
    return parseAndBuildResult(content, url);
  } catch (err: any) {
    return { success: false, error: err.message || 'Network error' };
  }
}

function parseAndBuildResult(content: string, originalUrl: string): ImportResult {
  // Check if content looks like HTML (GitHub 404 page)
  if (content.trim().startsWith('<!DOCTYPE') || content.trim().startsWith('<html')) {
    return { success: false, error: 'URL returned HTML instead of SKILL.md content. Check the URL.' };
  }

  const skill = parseSkillMd(content);
  if (!skill) {
    return { success: false, error: 'Failed to parse SKILL.md. Ensure it has valid YAML frontmatter with name and description fields.' };
  }

  // Attach source info
  skill.source = extractSourceId(originalUrl);

  return { success: true, skill };
}

/**
 * Check if a URL looks like it could be a GitHub skill URL.
 */
export function isGitHubUrl(url: string): boolean {
  return url.includes('github.com') || url.includes('raw.githubusercontent.com');
}
