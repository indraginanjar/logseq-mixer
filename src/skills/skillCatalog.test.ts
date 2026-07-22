import { describe, expect, it } from 'vitest';
import { buildSkillCatalogPrompt, buildSkillActivationContext, buildActivatedSkillsSummary } from './skillCatalog';
import { normalizeGitHubUrl, isGitHubUrl } from './skillImporter';

describe('buildSkillCatalogPrompt', () => {
  it('returns empty string when no skills', () => {
    expect(buildSkillCatalogPrompt([])).toBe('');
  });

  it('builds catalog with single skill', () => {
    const result = buildSkillCatalogPrompt([
      { name: 'pdf-processing', description: 'Handle PDFs.' },
    ]);
    expect(result).toContain('## Available Skills');
    expect(result).toContain('pdf-processing');
    expect(result).toContain('Handle PDFs.');
    expect(result).toContain('activate_skill');
  });

  it('builds catalog with multiple skills', () => {
    const result = buildSkillCatalogPrompt([
      { name: 'pdf-processing', description: 'Handle PDFs.' },
      { name: 'data-analysis', description: 'Analyze data.' },
      { name: 'code-review', description: 'Review code quality.' },
    ]);
    expect(result).toContain('pdf-processing');
    expect(result).toContain('data-analysis');
    expect(result).toContain('code-review');
  });

  it('includes user slash command instruction', () => {
    const result = buildSkillCatalogPrompt([
      { name: 'test', description: 'Test skill.' },
    ]);
    expect(result).toContain('/skill');
  });
});

describe('buildSkillActivationContext', () => {
  it('wraps skill body in structured tags', () => {
    const result = buildSkillActivationContext({
      name: 'pdf-processing',
      description: 'Handle PDFs.',
      enabled: true,
      body: '# Instructions\nDo the thing.',
      pageName: 'Mixer/Skills/pdf-processing',
    });
    expect(result).toContain('<skill_content name="pdf-processing">');
    expect(result).toContain('# Instructions');
    expect(result).toContain('Do the thing.');
    expect(result).toContain('</skill_content>');
  });
});

describe('buildActivatedSkillsSummary', () => {
  it('returns empty string when no skills activated', () => {
    expect(buildActivatedSkillsSummary([])).toBe('');
  });

  it('lists activated skill names', () => {
    const result = buildActivatedSkillsSummary(['pdf-processing', 'data-analysis']);
    expect(result).toContain('pdf-processing');
    expect(result).toContain('data-analysis');
    expect(result).toContain('Active skills');
  });
});

describe('normalizeGitHubUrl', () => {
  it('passes through raw.githubusercontent.com URLs unchanged', () => {
    const url = 'https://raw.githubusercontent.com/user/repo/main/SKILL.md';
    expect(normalizeGitHubUrl(url)).toBe(url);
  });

  it('converts blob URL to raw', () => {
    expect(normalizeGitHubUrl('https://github.com/user/repo/blob/main/skills/pdf/SKILL.md')).toBe(
      'https://raw.githubusercontent.com/user/repo/main/skills/pdf/SKILL.md'
    );
  });

  it('converts tree URL to raw with SKILL.md appended', () => {
    expect(normalizeGitHubUrl('https://github.com/user/repo/tree/main/skills/pdf')).toBe(
      'https://raw.githubusercontent.com/user/repo/main/skills/pdf/SKILL.md'
    );
  });

  it('converts plain repo URL to raw SKILL.md at root/main', () => {
    expect(normalizeGitHubUrl('https://github.com/user/repo')).toBe(
      'https://raw.githubusercontent.com/user/repo/main/SKILL.md'
    );
  });

  it('handles repo URL with trailing slash', () => {
    expect(normalizeGitHubUrl('https://github.com/user/repo/')).toBe(
      'https://raw.githubusercontent.com/user/repo/main/SKILL.md'
    );
  });

  it('passes non-GitHub URLs through unchanged', () => {
    const url = 'https://example.com/skills/SKILL.md';
    expect(normalizeGitHubUrl(url)).toBe(url);
  });
});

describe('isGitHubUrl', () => {
  it('returns true for github.com URLs', () => {
    expect(isGitHubUrl('https://github.com/user/repo')).toBe(true);
  });

  it('returns true for raw.githubusercontent.com URLs', () => {
    expect(isGitHubUrl('https://raw.githubusercontent.com/user/repo/main/SKILL.md')).toBe(true);
  });

  it('returns false for non-GitHub URLs', () => {
    expect(isGitHubUrl('https://example.com/skill')).toBe(false);
  });
});
