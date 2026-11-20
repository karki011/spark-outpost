import { useSyncExternalStore } from 'react';

let requested: string | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export function revealStep(anchor: string): void {
  requested = anchor;
  notify();
}

export function clearRevealedStep(): void {
  if (requested === null) return;
  requested = null;
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useRevealedStep(): string | null {
  return useSyncExternalStore(subscribe, () => requested);
}
