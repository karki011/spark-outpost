import { useEffect, useSyncExternalStore } from 'react';
import type { CreateTeammateRequest, Teammate } from '@spark-outpost/contracts';

export type SheetRequest =
  { kind: 'create'; seed?: CreateTeammateRequest } | { kind: 'edit'; id: string; focus?: 'delete' };

export interface PendingDelete {
  id: string;
  name: string;
}

interface TeammateUiState {
  sheet: SheetRequest | null;
  deleting: PendingDelete | null;
  deleteProblem: string | null;
}

let state: TeammateUiState = { sheet: null, deleting: null, deleteProblem: null };
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
  update({ sheet: null, deleting, deleteProblem: null });
}

export function reportTeammateDeleteProblem(deleteProblem: string | null): void {
  update({ deleteProblem });
}

export function clearTeammateDelete(): void {
  update({ deleting: null });
}

export function useTeammateUi(): TeammateUiState {
  return useSyncExternalStore(subscribe, () => state);
}

const createdListeners = new Set<(teammate: Teammate) => void>();

export function announceTeammateCreated(teammate: Teammate): void {
  for (const listener of createdListeners) listener(teammate);
}

export function useTeammateCreated(onCreated: (teammate: Teammate) => void): void {
  useEffect(() => {
    createdListeners.add(onCreated);
    return () => {
      createdListeners.delete(onCreated);
    };
  }, [onCreated]);
}
