import { use, useSyncExternalStore } from 'react';
import type { PendingEntry } from '../status/status-store.ts';
import { StatusContext } from '../status/status-context.ts';

const NONE: readonly PendingEntry[] = [];
const quiet = () => () => undefined;

export function waitingPlace(entries: readonly PendingEntry[], id: string): string | null {
  if (entries.length < 2) return null;
  const index = entries.findIndex((entry) => entry.id === id);
  return index < 0 ? null : `${index + 1} of ${entries.length} waiting`;
}

export function useWaitingPlace(id: string): string | null {
  const store = use(StatusContext);
  const entries = useSyncExternalStore(
    store ? store.subscribe : quiet,
    () => store?.snapshot().pending ?? NONE,
  );
  return waitingPlace(entries, id);
}
