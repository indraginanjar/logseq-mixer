import { describe, it, expect } from 'vitest';
import { detectExplicitMemory } from './memoryDetector';

describe('memoryDetector', () => {
  it('detects explicit remember with colon', () => {
    const result = detectExplicitMemory('Remember this: I prefer bullet points');
    expect(result).not.toBeNull();
    expect(result!.content).toBe('I prefer bullet points');
    expect(result!.category).toBe('preference');
  });

  it('rejects do you remember as false trigger', () => {
    const result = detectExplicitMemory('Do you remember what we discussed?');
    expect(result).toBeNull();
  });

  it('rejects I remember as false trigger', () => {
    const result = detectExplicitMemory('I remember that meeting was important');
    expect(result).toBeNull();
  });

  it('rejects don\'t forget things easily', () => {
    const result = detectExplicitMemory("I don't forget things easily");
    expect(result).toBeNull();
  });

  it('rejects trigger at end with no meaningful content', () => {
    const result = detectExplicitMemory('Can you remember that for me?');
    expect(result).toBeNull();
  });

  it('detects task category', () => {
    const result = detectExplicitMemory('Remember this: I need to finish the report by Friday');
    expect(result).not.toBeNull();
    expect(result!.category).toBe('task');
  });

  it('detects fact category as default', () => {
    const result = detectExplicitMemory('Remember this: The project uses React 17');
    expect(result).not.toBeNull();
    expect(result!.category).toBe('fact');
  });
});
