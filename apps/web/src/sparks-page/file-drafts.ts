import { useSyncExternalStore } from 'react';

export interface FileDraft {
  text: string;
  baseHash: string | null;
}

type Drafts = ReadonlyMap<string, FileDraft>;

let drafts: Drafts = new Map();
const listeners = new Set<() => void>();

const keyOf = (sparkId: string, path: string) => `${sparkId}/${path}`;

function replace(next: Map<string, FileDraft>): void {
  drafts = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setFileDraft(sparkId: string, path: string, draft: FileDraft): void {
  replace(new Map(drafts).set(keyOf(sparkId, path), draft));
}

export function clearFileDraft(sparkId: string, path: string): void {
  if (!drafts.has(keyOf(sparkId, path))) return;
  const next = new Map(drafts);
  next.delete(keyOf(sparkId, path));
  replace(next);
}

export function settleFileDraft(
  sparkId: string,
  path: string,
  saved: { text: string; hash: string },
): void {
  const current = drafts.get(keyOf(sparkId, path));
  if (!current) return;
  if (current.text === saved.text) clearFileDraft(sparkId, path);
  else setFileDraft(sparkId, path, { text: current.text, baseHash: saved.hash });
}

export function useFileDraft(sparkId: string, path: string): FileDraft | null {
  return useSyncExternalStore(subscribe, () => drafts.get(keyOf(sparkId, path)) ?? null);
}

export function useEditedPaths(sparkId: string): ReadonlySet<string> {
  const all = useSyncExternalStore(subscribe, () => drafts);
  const prefix = `${sparkId}/`;
  return new Set(
    [...all.keys()].filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length)),
  );
}
