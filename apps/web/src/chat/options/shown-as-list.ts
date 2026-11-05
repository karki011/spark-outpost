import { useSyncExternalStore } from 'react';

const asList = new Set<string>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setShownAsList(runId: string, shown: boolean): void {
  if (shown) asList.add(runId);
  else asList.delete(runId);
  listeners.forEach((listener) => listener());
}

export function useShownAsList(runId: string): boolean {
  return useSyncExternalStore(subscribe, () => asList.has(runId));
}
