import { useSyncExternalStore } from 'react';

export interface MemberChatTarget {
  conversationId: string;
  runId: string;
}

let target: MemberChatTarget | null = null;
let opener: HTMLElement | null = null;
const listeners = new Set<() => void>();

function set(next: MemberChatTarget | null) {
  target = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useMemberChat(): MemberChatTarget | null {
  return useSyncExternalStore(subscribe, () => target);
}

export function openMemberChat(conversationId: string, runId: string) {
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  set({ conversationId, runId });
}

export function closeMemberChat() {
  const back = opener;
  opener = null;
  set(null);
  if (back?.isConnected) back.focus({ preventScroll: true });
}
