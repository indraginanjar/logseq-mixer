import { describe, expect, it } from 'vitest';
import { parseSkillMd, validateSkillName, skillToLogseqBlocks, blockContentToSkill, skillToSkillMd } from './skillParser';

describe('validateSkillName', () => {
  it('accepts valid names', () => {
    expect(validateSkillName('pdf-processing').valid).toBe(true);
    expect(validateSkillName('data-analysis').valid).toBe(true);
    expect(validateSkillName('code-review').valid).toBe(true);
    expect(validateSkillName('a').valid).toBe(true);
    expect(validateSkillName('a1b2c3').valid).toBe(true);
  });

  it('rejects empty name', () => {
    expect(validateSkillName('').valid).toBe(false);
  });

  it('rejects names over 64 characters', () => {
    expect(validateSkillName('a'.repeat(65)).valid).toBe(false);
    expect(validateSkillName('a'.repeat(64)).valid).toBe(true);
  });

  it('rejects uppercase', () => {
    expect(validateSkillName('PDF-Processing').valid).toBe(false);
  });

  it('rejects names starting or ending with hyphen', () => {
    expect(validateSkillName('-pdf').valid).toBe(false);
    expect(validateSkillName('pdf-').valid).toBe(false);
  });

  it('rejects consecutive hyphens', () => {
    expect(validateSkillName('pdf--processing').valid).toBe(false);
  });

  it('rejects special characters', () => {
    expect(validateSkillName('pdf_processing').valid).toBe(false);
    expect(validateSkillName('pdf processing').valid).toBe(false);
    expect(validateSkillName('pdf.processing').valid).toBe(false);
  });
});

describe('parseSkillMd', () => {
  it('parses valid SKILL.md with name and description', () => {
    const content = `---
name: pdf-processing
description: Extract PDF text, fill forms, merge files. Use when handling PDFs.
---

# PDF Processing

Use this skill when working with PDF documents.

## Steps
1. Extract text
2. Process forms
`;
    const result = parseSkillMd(content);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('pdf-processing');
    expect(result!.description).toBe('Extract PDF text, fill forms, merge files. Use when handling PDFs.');
    expect(result!.enabled).toBe(true);
    expect(result!.body).toContain('# PDF Processing');
    expect(result!.body).toContain('## Steps');
    expect(result!.pageName).toBe('Mixer/Skills/pdf-processing');
  });

  it('parses SKILL.md with all optional fields', () => {
    const content = `---
name: data-analysis
description: Analyze datasets, generate charts, and create summary reports.
license: Apache-2.0
metadata:
  author: example-org
  version: "1.0"
---

Instructions here.
`;
    const result = parseSkillMd(content);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('data-analysis');
    expect(result!.license).toBe('Apache-2.0');
    expect(result!.metadata).toEqual({ author: 'example-org', version: '1.0' });
  });

  it('returns null when frontmatter is missing', () => {
    const content = '# No frontmatter\nJust body content.';
    expect(parseSkillMd(content)).toBeNull();
  });

  it('returns null when name is missing', () => {
    const content = `---
description: Some description
---
Body`;
    expect(parseSkillMd(content)).toBeNull();
  });

  it('returns null when description is missing', () => {
    const content = `---
name: test-skill
---
Body`;
    expect(parseSkillMd(content)).toBeNull();
  });

  it('handles quoted values in frontmatter', () => {
    const content = `---
name: "quoted-skill"
description: "A skill with quoted values"
---
Body`;
    const result = parseSkillMd(content);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('quoted-skill');
    expect(result!.description).toBe('A skill with quoted values');
  });

  it('handles lenient YAML with colons in description', () => {
    // This is technically invalid YAML but common in practice
    const content = `---
name: my-skill
description: Use this skill when: the user asks about X
---
Instructions`;
    const result = parseSkillMd(content);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('my-skill');
    // The parser captures everything after the first colon
    expect(result!.description).toContain('Use this skill when');
  });
});

describe('skillToLogseqBlocks', () => {
  it('converts a skill entry to Logseq properties and body', () => {
    const result = skillToLogseqBlocks({
      name: 'pdf-processing',
      description: 'Extract PDF text.',
      enabled: true,
      body: '# Instructions\nDo the thing.',
      source: 'github:user/repo',
      license: 'MIT',
      pageName: 'Mixer/Skills/pdf-processing',
    });

    expect(result.properties).toContain('name:: pdf-processing');
    expect(result.properties).toContain('description:: Extract PDF text.');
    expect(result.properties).toContain('enabled:: true');
    expect(result.properties).toContain('source:: github:user/repo');
    expect(result.properties).toContain('license:: MIT');
    expect(result.bodyLines).toContain('# Instructions');
    expect(result.bodyLines).toContain('Do the thing.');
  });

  it('omits undefined optional fields', () => {
    const result = skillToLogseqBlocks({
      name: 'simple',
      description: 'Simple skill.',
      enabled: false,
      body: 'Body text.',
      pageName: 'Mixer/Skills/simple',
    });

    expect(result.properties).not.toContain('source::');
    expect(result.properties).not.toContain('license::');
    expect(result.properties).toContain('enabled:: false');
  });
});

describe('blockContentToSkill', () => {
  it('converts block content to a skill with provided name and description', () => {
    const result = blockContentToSkill('Always use TypeScript strict mode.', 'ts-strict', 'Enforce TypeScript strict mode');
    expect(result).not.toBeNull();
    expect(result!.name).toBe('ts-strict');
    expect(result!.description).toBe('Enforce TypeScript strict mode');
    expect(result!.body).toBe('Always use TypeScript strict mode.');
    expect(result!.enabled).toBe(true);
    expect(result!.pageName).toBe('Mixer/Skills/ts-strict');
  });

  it('auto-generates description from body when not provided', () => {
    const result = blockContentToSkill('# My Instructions\nDo X then Y.', 'my-skill');
    expect(result).not.toBeNull();
    expect(result!.description).toBe('Do X then Y.');
  });

  it('returns null for invalid name', () => {
    expect(blockContentToSkill('content', 'INVALID')).toBeNull();
    expect(blockContentToSkill('content', '')).toBeNull();
  });

  it('returns null for empty content', () => {
    expect(blockContentToSkill('', 'valid-name')).toBeNull();
    expect(blockContentToSkill('   ', 'valid-name')).toBeNull();
  });
});

describe('skillToSkillMd', () => {
  it('exports a skill to SKILL.md format', () => {
    const md = skillToSkillMd({
      name: 'pdf-processing',
      description: 'Handle PDFs.',
      enabled: true,
      body: '# Instructions\nProcess the PDF.',
      license: 'MIT',
      pageName: 'Mixer/Skills/pdf-processing',
    });

    expect(md).toContain('---');
    expect(md).toContain('name: pdf-processing');
    expect(md).toContain('description: Handle PDFs.');
    expect(md).toContain('license: MIT');
    expect(md).toContain('# Instructions');
    expect(md).toContain('Process the PDF.');
  });

  it('round-trips: parse → export → parse produces same skill', () => {
    const original = `---
name: roundtrip-test
description: Test roundtrip conversion.
license: Apache-2.0
---

# Instructions
Step 1: Do this.
Step 2: Do that.`;

    const parsed = parseSkillMd(original);
    expect(parsed).not.toBeNull();
    const exported = skillToSkillMd(parsed!);
    const reparsed = parseSkillMd(exported);
    expect(reparsed).not.toBeNull();
    expect(reparsed!.name).toBe(parsed!.name);
    expect(reparsed!.description).toBe(parsed!.description);
    expect(reparsed!.license).toBe(parsed!.license);
    expect(reparsed!.body).toContain('Step 1: Do this.');
  });
});
