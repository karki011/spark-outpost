import { useSyncExternalStore } from 'react';

export interface PendingDraft {
  text: string;
  afterTyped: boolean;
}

const drafts = new Map<string, PendingDraft>();
const focusRequests = new Map<string, number>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setPendingDraft(conversationId: string, draft: PendingDraft): void {
  drafts.set(conversationId, draft);
  listeners.forEach((listener) => listener());
}

export function queueDraft(conversationId: string, text: string): void {
  setPendingDraft(conversationId, { text, afterTyped: false });
}

export function queueDraftAfterTyped(conversationId: string, text: string): void {
  setPendingDraft(conversationId, { text, afterTyped: true });
}

export function takeDraft(conversationId: string): PendingDraft | null {
  const pending = drafts.get(conversationId) ?? null;
  if (drafts.delete(conversationId)) listeners.forEach((listener) => listener());
  return pending;
}

export function usePendingDraft(conversationId: string): PendingDraft | null {
  return useSyncExternalStore(subscribe, () => drafts.get(conversationId) ?? null);
}

export function requestComposerFocus(conversationId: string): void {
  focusRequests.set(conversationId, (focusRequests.get(conversationId) ?? 0) + 1);
  listeners.forEach((listener) => listener());
}

export function consumeComposerFocus(conversationId: string, request: number): void {
  if (focusRequests.get(conversationId) !== request) return;
  focusRequests.delete(conversationId);
  listeners.forEach((listener) => listener());
}

export function useComposerFocusRequest(conversationId: string): number {
  return useSyncExternalStore(subscribe, () => focusRequests.get(conversationId) ?? 0);
}
