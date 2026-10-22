import { useMemo, useSyncExternalStore } from 'react';

export interface OpenArtifact {
  id: string;
  version: number | null;
  shown: boolean;
}

const opened = new Map<string, OpenArtifact>();
const listeners = new Set<() => void>();

function changed(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function openArtifact(chatId: string, id: string, version: number | null = null): void {
  opened.set(chatId, { id, version, shown: true });
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
  if (!opened.delete(chatId)) return;
  changed();
}

export interface ArtifactPaneChoice {
  current: OpenArtifact;
  setShown(shown: boolean): void;
  pickVersion(version: number): void;
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
        close: () => closeArtifact(chatId),
      },
    [chatId, current],
  );
}
