import { useSyncExternalStore } from 'react';

export interface TvPosition {
  x: number;
  y: number;
}

export type TvSize = 's' | 'm' | 'l';

export const TV_SIZES: readonly TvSize[] = ['s', 'm', 'l'];

export interface AgentTvState {
  sourceId: string | null;
  position: TvPosition | null;
  size: TvSize;
  watch: boolean;
  muted: boolean;
}

interface SavedTv {
  position: TvPosition | null;
  size: TvSize;
  muted: boolean;
}

const STORAGE_KEY = 'spark-outpost.agent-tv';

function isPosition(value: unknown): value is TvPosition {
  if (!value || typeof value !== 'object') return false;
  const { x, y } = value as Record<string, unknown>;
  return Number.isFinite(x) && Number.isFinite(y);
}

export function parseSavedTv(raw: string | null): SavedTv {
  const fallback: SavedTv = { position: null, size: 's', muted: false };
  if (!raw) return fallback;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    return {
      position: isPosition(value.position) ? value.position : null,
      size: TV_SIZES.includes(value.size as TvSize) ? (value.size as TvSize) : 's',
      muted: value.muted === true,
    };
  } catch {
    return fallback;
  }
}

function readSaved(): SavedTv {
  try {
    return parseSavedTv(localStorage.getItem(STORAGE_KEY));
  } catch {
    return parseSavedTv(null);
  }
}

function save(next: AgentTvState) {
  const saved: SavedTv = { position: next.position, size: next.size, muted: next.muted };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {
    return;
  }
}

let state: AgentTvState = { sourceId: null, watch: false, ...readSaved() };
const listeners = new Set<() => void>();

function set(next: Partial<AgentTvState>) {
  state = { ...state, ...next };
  save(state);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAgentTv(): AgentTvState {
  return useSyncExternalStore(subscribe, () => state);
}

export function openAgentTv(conversationId: string) {
  set({ sourceId: conversationId });
}

export function closeAgentTv() {
  set({ sourceId: null, watch: false });
}

export function moveAgentTv(position: TvPosition | null) {
  set({ position });
}

export function resizeAgentTv(size: TvSize) {
  set({ size });
}

export function setTvWatch(watch: boolean) {
  set({ watch });
}

export function setTvMuted(muted: boolean) {
  set({ muted });
}
