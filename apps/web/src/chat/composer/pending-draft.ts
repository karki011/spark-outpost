import { useSyncExternalStore } from 'react';

const drafts = new Map<string, string>();
const focusRequests = new Map<string, number>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function queueDraft(conversationId: string, text: string): void {
  drafts.set(conversationId, text);
  listeners.forEach((listener) => listener());
}

export function takeDraft(conversationId: string): void {
  if (drafts.delete(conversationId)) listeners.forEach((listener) => listener());
}

export function usePendingDraft(conversationId: string): string | null {
  return useSyncExternalStore(subscribe, () => drafts.get(conversationId) ?? null);
}

export function requestComposerFocus(conversationId: string): void {
  focusRequests.set(conversationId, (focusRequests.get(conversationId) ?? 0) + 1);
  listeners.forEach((listener) => listener());
}

export function useComposerFocusRequest(conversationId: string): number {
  return useSyncExternalStore(subscribe, () => focusRequests.get(conversationId) ?? 0);
}
