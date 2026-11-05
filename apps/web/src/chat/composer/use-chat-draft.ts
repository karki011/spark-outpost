import { useCallback, useSyncExternalStore, type Dispatch, type SetStateAction } from 'react';

const drafts = new Map<string, string>();
const listeners = new Map<string, Set<() => void>>();

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
  const text = useSyncExternalStore(subscribeChat, () => drafts.get(conversationId) ?? '');
  const setDraft = useCallback<Dispatch<SetStateAction<string>>>(
    (value) => {
      const next = typeof value === 'function' ? value(drafts.get(conversationId) ?? '') : value;
      if (next) drafts.set(conversationId, next);
      else drafts.delete(conversationId);
      listeners.get(conversationId)?.forEach((listener) => listener());
    },
    [conversationId],
  );
  return [text, setDraft];
}
