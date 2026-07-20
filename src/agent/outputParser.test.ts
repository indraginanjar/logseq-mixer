import { describe, it, expect } from 'vitest';
import { parseStepOutput } from './outputParser';

describe('parseStepOutput', () => {
  it('parses plain text as type text', () => {
    const output = parseStepOutput(1, 'Hello world', 'think');
    expect(output.type).toBe('text');
    expect(output.content).toBe('Hello world');
    expect(output.structured).toBeUndefined();
  });

  it('detects error outputs', () => {
    const output = parseStepOutput(1, 'Error: page not found', 'read');
    expect(output.type).toBe('error');
  });

  it('detects Failed: prefix as error', () => {
    const output = parseStepOutput(1, 'Failed: connection timeout', 'tool');
    expect(output.type).toBe('error');
  });

  it('detects REQUEST: prefix as request type', () => {
    const output = parseStepOutput(1, 'REQUEST: need page content for ProjectA', 'specialist');
    expect(output.type).toBe('request');
  });

  it('parses JSON request body in request output', () => {
    const output = parseStepOutput(1, 'REQUEST: {"action":"read","page":"ProjectA"}', 'specialist');
    expect(output.type).toBe('request');
    expect(output.structured).toEqual({ action: 'read', page: 'ProjectA' });
  });

  it('extracts structured data from ```json blocks', () => {
    const raw = 'Here is the data:\n```json\n{"pages": ["A", "B"], "count": 2}\n```\nDone.';
    const output = parseStepOutput(1, raw, 'gather');
    expect(output.type).toBe('data');
    expect(output.structured).toEqual({ pages: ['A', 'B'], count: 2 });
  });

  it('extracts structured data from raw JSON object', () => {
    const output = parseStepOutput(1, '{"key": "value"}', 'think');
    expect(output.type).toBe('data');
    expect(output.structured).toEqual({ key: 'value' });
  });

  it('extracts structured data from raw JSON array', () => {
    const output = parseStepOutput(1, '["a", "b", "c"]', 'think');
    expect(output.type).toBe('data');
    expect(output.structured).toEqual(['a', 'b', 'c']);
  });

  it('does not set structured for invalid JSON', () => {
    const output = parseStepOutput(1, '{not valid json}', 'think');
    expect(output.type).toBe('text');
    expect(output.structured).toBeUndefined();
  });

  it('extracts page names from [[...]] patterns', () => {
    const output = parseStepOutput(1, 'Found pages [[ProjectA]] and [[ProjectB]]', 'search');
    expect(output.metadata?.pageNames).toEqual(['ProjectA', 'ProjectB']);
  });

  it('deduplicates page names', () => {
    const output = parseStepOutput(1, '[[A]] and [[A]] again', 'search');
    expect(output.metadata?.pageNames).toEqual(['A']);
  });

  it('extracts block UUIDs', () => {
    const output = parseStepOutput(1, 'Block 12345678-1234-1234-1234-123456789abc found', 'read');
    expect(output.metadata?.blockUUIDs).toEqual(['12345678-1234-1234-1234-123456789abc']);
  });

  it('deduplicates block UUIDs', () => {
    const uuid = 'abcdef01-2345-6789-abcd-ef0123456789';
    const output = parseStepOutput(1, `${uuid} and ${uuid}`, 'read');
    expect(output.metadata?.blockUUIDs).toEqual([uuid]);
  });

  it('does not set metadata when no patterns found', () => {
    const output = parseStepOutput(1, 'plain text no special patterns', 'think');
    expect(output.metadata).toBeUndefined();
  });

  it('preserves stepId', () => {
    const output = parseStepOutput(42, 'test', 'think');
    expect(output.stepId).toBe(42);
  });
});
