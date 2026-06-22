import { describe, expect, it } from 'vitest';
import { buildEditSystemPrompt, buildPageContextMessage } from './editPromptBuilder';

describe('buildEditSystemPrompt', () => {
  const prompt = buildEditSystemPrompt();

  it('contains all required field names', () => {
    expect(prompt).toContain('action');
    expect(prompt).toContain('blockUUID');
    expect(prompt).toContain('parentBlockUUID');
    expect(prompt).toContain('content');
    expect(prompt).toContain('siblingOrder');
  });

  it('mentions all supported action types', () => {
    expect(prompt).toContain('insert');
    expect(prompt).toContain('update');
    expect(prompt).toContain('delete');
  });

  it('includes json-edit fence instruction', () => {
    expect(prompt).toContain('json-edit');
  });
});

describe('buildPageContextMessage', () => {
  it('includes the page name in the output', () => {
    const result = buildPageContextMessage('My Page', 'page-uuid', null, null, false, '[uuid:a-1] - Block');
    expect(result).toContain('My Page');
  });

  it('includes the formatted tree in the output', () => {
    const tree = '[uuid:aaa-111] - First\n  [uuid:bbb-222] - Child';
    const result = buildPageContextMessage('Test', 'test-uuid', null, null, false, tree);
    expect(result).toContain(tree);
  });

  it('formats as Page header followed by Blocks section', () => {
    const result = buildPageContextMessage('Notes', 'notes-uuid', 'selected-uuid', 'hello', false, '[uuid:x] - content');
    expect(result).toMatch(/^Page Name:.*"Notes"/);
    expect(result).toContain('Blocks:');
    expect(result).toContain('notes-uuid');
    expect(result).toContain('selected-uuid');
    expect(result).toContain('hello');
  });
});
