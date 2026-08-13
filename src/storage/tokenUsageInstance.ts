import { TokenUsageStore } from './TokenUsageStore';

let tokenUsageStore: TokenUsageStore | null = null;

export function setTokenUsageStore(store: TokenUsageStore): void {
  tokenUsageStore = store;
}

export function getTokenUsageStore(): TokenUsageStore | null {
  return tokenUsageStore;
}
