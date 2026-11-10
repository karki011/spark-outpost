import { useCallback, useSyncExternalStore, type Dispatch, type SetStateAction } from 'react';

import { loadDrafts, storeDraft } from './draft-storage.ts';

const PERSIST_DELAY_MS = 400;
const drafts = new Map<string, string>();
const listeners = new Map<string, Set<() => void>>();
const pending = new Map<string, ReturnType<typeof setTimeout>>();
let hydrated = false;

function flushPending(): void {
  for (const [id, timer] of pending) {
    clearTimeout(timer);
    storeDraft(id, drafts.get(id) ?? '');
  }
  pending.clear();
}

function hydrate(): void {
  if (hydrated) return;
  hydrated = true;
  for (const [id, text] of loadDrafts()) if (!drafts.has(id)) drafts.set(id, text);
  if (typeof window !== 'undefined') window.addEventListener('pagehide', flushPending);
}

function draftOf(conversationId: string): string {
  hydrate();
  return drafts.get(conversationId) ?? '';
}

function persist(conversationId: string): void {
  const timer = pending.get(conversationId);
  if (timer) clearTimeout(timer);
  if (!drafts.has(conversationId)) {
    pending.delete(conversationId);
    storeDraft(conversationId, '');
    return;
  }
  pending.set(
    conversationId,
    setTimeout(() => {
      pending.delete(conversationId);
      storeDraft(conversationId, drafts.get(conversationId) ?? '');
    }, PERSIST_DELAY_MS),
  );
}

export function restoreFailedDraft(current: string, failed: string): string {
  if (!failed) return current;
  return current ? `${current}\n\n${failed}` : failed;
}

function subscribe(conversationId: string, listener: () => void): () => void {
  const group = listeners.get(conversationId) ?? new Set();
  group.add(listener);
  listeners.set(conversationId, group);
  return () => {
    group.delete(listener);
    if (group.size === 0) listeners.delete(conversationId);
  };
}

export function useChatDraft(conversationId: string): [string, Dispatch<SetStateAction<string>>] {
  const subscribeChat = useCallback(
    (listener: () => void) => subscribe(conversationId, listener),
    [conversationId],
  );
  const text = useSyncExternalStore(subscribeChat, () => draftOf(conversationId));
  const setDraft = useCallback<Dispatch<SetStateAction<string>>>(
    (value) => {
      const next = typeof value === 'function' ? value(draftOf(conversationId)) : value;
      if (next) drafts.set(conversationId, next);
      else drafts.delete(conversationId);
      persist(conversationId);
      listeners.get(conversationId)?.forEach((listener) => listener());
    },
    [conversationId],
  );
  return [text, setDraft];
}
