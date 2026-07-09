import { describe, it, expect } from 'vitest';
import { shouldRetrieveContext } from './intentClassifier';

describe('shouldRetrieveContext', () => {
  describe('returns false for direct instructions (no RAG needed)', () => {
    it('skips RAG for "create" instructions', () => {
      expect(shouldRetrieveContext('Create a table with columns Number, Square, Power of 3')).toBe(false);
      expect(shouldRetrieveContext('create a summary of the following text')).toBe(false);
    });

    it('skips RAG for "generate" instructions', () => {
      expect(shouldRetrieveContext('Generate a list of 10 random names')).toBe(false);
      expect(shouldRetrieveContext('generate code for a fibonacci function')).toBe(false);
    });

    it('skips RAG for "write" instructions', () => {
      expect(shouldRetrieveContext('Write a poem about the ocean')).toBe(false);
      expect(shouldRetrieveContext('write me a bash script that renames files')).toBe(false);
    });

    it('skips RAG for "translate" instructions', () => {
      expect(shouldRetrieveContext('Translate this to French: Hello world')).toBe(false);
      expect(shouldRetrieveContext('translate the following paragraph to Japanese')).toBe(false);
    });

    it('skips RAG for "explain" general concepts', () => {
      expect(shouldRetrieveContext('Explain what a neural network is')).toBe(false);
      expect(shouldRetrieveContext('explain how photosynthesis works')).toBe(false);
      expect(shouldRetrieveContext('explain the difference between TCP and UDP')).toBe(false);
    });

    it('skips RAG for "list/show me" + output type', () => {
      expect(shouldRetrieveContext('List a table of prime numbers under 50')).toBe(false);
      expect(shouldRetrieveContext('show me a code example for async/await')).toBe(false);
      expect(shouldRetrieveContext('give me a list of common HTTP status codes')).toBe(false);
    });

    it('skips RAG for math/calculation', () => {
      expect(shouldRetrieveContext('Calculate 15% of 230')).toBe(false);
      expect(shouldRetrieveContext('compute the factorial of 7')).toBe(false);
    });

    it('skips RAG for code generation', () => {
      expect(shouldRetrieveContext('Code a function that reverses a string')).toBe(false);
      expect(shouldRetrieveContext('implement binary search in Python')).toBe(false);
    });

    it('skips RAG for greetings', () => {
      expect(shouldRetrieveContext('Hi')).toBe(false);
      expect(shouldRetrieveContext('hello')).toBe(false);
      expect(shouldRetrieveContext('thanks')).toBe(false);
    });

    it('skips RAG for very short queries (1-2 words) without note references', () => {
      expect(shouldRetrieveContext('hi')).toBe(false);
      expect(shouldRetrieveContext('test')).toBe(false);
      expect(shouldRetrieveContext('help me')).toBe(false);
    });
  });

  describe('returns true for queries that reference notes/graph (RAG needed)', () => {
    it('retrieves for explicit "my notes" references', () => {
      expect(shouldRetrieveContext('What do my notes say about project deadlines?')).toBe(true);
      expect(shouldRetrieveContext('summarize my notes on machine learning')).toBe(true);
    });

    it('retrieves for "in logseq" references', () => {
      expect(shouldRetrieveContext('What pages in logseq mention React?')).toBe(true);
    });

    it('retrieves for "I wrote/noted" references', () => {
      expect(shouldRetrieveContext('What did I write about the API design?')).toBe(true);
      expect(shouldRetrieveContext('When did I mention the deployment deadline?')).toBe(true);
    });

    it('retrieves for [[page link]] references', () => {
      expect(shouldRetrieveContext('What is [[Project Alpha]] about?')).toBe(true);
      expect(shouldRetrieveContext('Summarize [[Meeting Notes]]')).toBe(true);
    });

    it('retrieves for ((block ref)) references', () => {
      expect(shouldRetrieveContext('Expand on ((abc123-def456))')).toBe(true);
    });

    it('retrieves for "find/search in my" patterns', () => {
      expect(shouldRetrieveContext('Find all references to authentication in my notes')).toBe(true);
      expect(shouldRetrieveContext('search my pages for migration strategy')).toBe(true);
    });
  });

  describe('returns true for general knowledge questions (default behavior)', () => {
    it('retrieves for open-ended questions without direct instruction verbs', () => {
      expect(shouldRetrieveContext('What is the migration strategy for phase 2?')).toBe(true);
      expect(shouldRetrieveContext('How does the authentication system work?')).toBe(true);
    });

    it('retrieves for topic-based queries', () => {
      expect(shouldRetrieveContext('project deadlines and milestones')).toBe(true);
      expect(shouldRetrieveContext('deployment architecture overview')).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('prioritizes note references over instruction patterns', () => {
      // "Create" is a direct instruction verb, but "my notes" overrides
      expect(shouldRetrieveContext('Create a summary from my notes about databases')).toBe(true);
    });

    it('handles empty/whitespace queries', () => {
      expect(shouldRetrieveContext('')).toBe(false);
      expect(shouldRetrieveContext('   ')).toBe(false);
    });
  });
});
