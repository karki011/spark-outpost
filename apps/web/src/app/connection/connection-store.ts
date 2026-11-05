import { useSyncExternalStore } from 'react';
import { isConnectionLoss } from './connection-failure.ts';

export interface ConnectionState {
  lost: boolean;
  recoveries: number;
}

let state: ConnectionState = { lost: false, recoveries: 0 };
const listeners = new Set<() => void>();

function publish(next: ConnectionState): void {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function markConnectionLost(): void {
  if (!state.lost) publish({ ...state, lost: true });
}

export function markConnectionRestored(): void {
  if (state.lost) publish({ lost: false, recoveries: state.recoveries + 1 });
}

export function reportRequestError(error: unknown): void {
  if (isConnectionLoss(error)) markConnectionLost();
}

export function useConnection(): ConnectionState {
  return useSyncExternalStore(subscribe, () => state);
}
