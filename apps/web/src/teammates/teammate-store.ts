import { useSyncExternalStore } from 'react';
import type { CreateTeammateRequest } from '@spark-outpost/contracts';

export type SheetRequest =
  { kind: 'create'; seed?: CreateTeammateRequest } | { kind: 'edit'; id: string };

export interface PendingDelete {
  id: string;
  name: string;
}

interface TeammateUiState {
  sheet: SheetRequest | null;
  deleting: PendingDelete | null;
}

let state: TeammateUiState = { sheet: null, deleting: null };
const listeners = new Set<() => void>();

function update(next: Partial<TeammateUiState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function openTeammateSheet(sheet: SheetRequest): void {
  update({ sheet });
}

export function closeTeammateSheet(): void {
  update({ sheet: null });
}

export function requestTeammateDelete(deleting: PendingDelete): void {
  update({ sheet: null, deleting });
}

export function clearTeammateDelete(): void {
  update({ deleting: null });
}

export function useTeammateUi(): TeammateUiState {
  return useSyncExternalStore(subscribe, () => state);
}
