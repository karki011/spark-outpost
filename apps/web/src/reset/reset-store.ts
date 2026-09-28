import { useSyncExternalStore } from 'react';

export type ResetState =
  | { phase: 'idle' }
  | { phase: 'counting'; keepApiKeys: boolean }
  | { phase: 'resetting' }
  | { phase: 'failed'; message: string };

let state: ResetState = { phase: 'idle' };
const listeners = new Set<() => void>();

export function setResetState(next: ResetState): void {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useResetState(): ResetState {
  return useSyncExternalStore(subscribe, () => state);
}
