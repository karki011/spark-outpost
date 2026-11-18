import { useMemo, useSyncExternalStore } from 'react';

export interface OpenArtifact {
  id: string;
  version: number | null;
  shown: boolean;
}

const opened = new Map<string, OpenArtifact>();
const focusWanted = new Set<string>();
const listeners = new Set<() => void>();

function changed(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

interface OpenOptions {
  version?: number | null;
  focus?: boolean;
}

export function openArtifact(
  chatId: string,
  id: string,
  { version = null, focus = false }: OpenOptions = {},
): void {
  opened.set(chatId, { id, version, shown: true });
  if (focus) focusWanted.add(chatId);
  changed();
}

function setShown(chatId: string, shown: boolean): void {
  const current = opened.get(chatId);
  if (!current || current.shown === shown) return;
  opened.set(chatId, { ...current, shown });
  changed();
}

function pickVersion(chatId: string, version: number): void {
  const current = opened.get(chatId);
  if (!current) return;
  opened.set(chatId, { ...current, version });
  changed();
}

function closeArtifact(chatId: string): void {
  focusWanted.delete(chatId);
  if (!opened.delete(chatId)) return;
  changed();
}

export interface ArtifactPaneChoice {
  current: OpenArtifact;
  setShown(shown: boolean): void;
  pickVersion(version: number): void;
  takeFocus(): boolean;
  close(): void;
}

export function useArtifactPane(chatId: string): ArtifactPaneChoice | null {
  const current = useSyncExternalStore(subscribe, () => opened.get(chatId) ?? null);
  return useMemo(
    () =>
      current && {
        current,
        setShown: (shown: boolean) => setShown(chatId, shown),
        pickVersion: (version: number) => pickVersion(chatId, version),
        takeFocus: () => focusWanted.delete(chatId),
        close: () => closeArtifact(chatId),
      },
    [chatId, current],
  );
}
