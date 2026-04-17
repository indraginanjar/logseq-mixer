// src/tokenizer.ts
import { Tiktoken } from "js-tiktoken/lite";
import cl100k_base from "js-tiktoken/ranks/cl100k_base";

let _instance: Tiktoken | null = null;

function getInstance(): Tiktoken {
  if (!_instance) {
    try {
      _instance = new Tiktoken(cl100k_base);
    } catch (err) {
      throw new Error(
        `Failed to initialize cl100k_base tokenizer: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  return _instance;
}

/** Return the exact cl100k_base token count for the given string. */
export function countTokens(text: string): number {
  return getInstance().encode(text).length;
}

/** Encode a string into cl100k_base token IDs. */
export function encode(text: string): number[] {
  return getInstance().encode(text);
}

/** Decode token IDs back to a string. */
export function decode(tokens: number[]): string {
  return getInstance().decode(tokens);
}
