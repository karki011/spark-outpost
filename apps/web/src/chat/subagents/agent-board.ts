import { createContext, use, useEffect, useSyncExternalStore } from 'react';
import type { SubagentRow } from '@spark-outpost/contracts';

export interface BoardEntry {
  runId: string;
  order: string;
  rows: readonly SubagentRow[];
  live: boolean;
}

export interface AgentBoard {
  subscribe(listener: () => void): () => void;
  shown(): BoardEntry | null;
  show(entry: BoardEntry): void;
  forget(runId: string): void;
  focusRequest(): number;
  requestFocus(): void;
}

export function createAgentBoard(): AgentBoard {
  const entries = new Map<string, BoardEntry>();
  const listeners = new Set<() => void>();
  let latest: BoardEntry | null = null;
  let focusRequest = 0;
  const notify = () => {
    for (const listener of listeners) listener();
  };

  const changed = () => {
    latest = null;
    for (const entry of entries.values()) {
      if (!latest || entry.order.localeCompare(latest.order) > 0) latest = entry;
    }
    notify();
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    shown: () => latest,
    show(entry) {
      const known = entries.get(entry.runId);
      const same =
        known !== undefined &&
        known.order === entry.order &&
        known.live === entry.live &&
        known.rows === entry.rows;
      if (same) return;
      entries.set(entry.runId, entry);
      changed();
    },
    forget(runId) {
      if (entries.delete(runId)) changed();
    },
    focusRequest: () => focusRequest,
    requestFocus() {
      focusRequest += 1;
      notify();
    },
  };
}

export const AgentBoardContext = createContext<AgentBoard | null>(null);

const noBoard = () => () => undefined;
const nothing = () => null;
const never = () => 0;

export function useAgentsFocusRequest(): number {
  const board = use(AgentBoardContext);
  return useSyncExternalStore(board?.subscribe ?? noBoard, board?.focusRequest ?? never);
}

export function useShownAgents(): BoardEntry | null {
  const board = use(AgentBoardContext);
  return useSyncExternalStore(board?.subscribe ?? noBoard, board?.shown ?? nothing);
}

export function useShowAgents(
  runId: string,
  order: string,
  rows: readonly SubagentRow[],
  live: boolean,
): void {
  const board = use(AgentBoardContext);
  const has = rows.length > 0;
  useEffect(() => {
    if (!board || !has) return;
    board.show({ runId, order, rows, live });
  }, [board, has, runId, order, rows, live]);
  useEffect(() => () => board?.forget(runId), [board, runId]);
}
