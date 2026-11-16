import { useSyncExternalStore } from 'react';
import type { BrowserProfile } from '@spark-outpost/contracts';

export interface TabChat {
  chatId: string;
  startedAt: number;
}

let chats: ReadonlyMap<string, TabChat> = new Map();
const listeners = new Set<() => void>();

function tabKey(profile: BrowserProfile, tabId: string): string {
  return `${profile}:${tabId}`;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setTabChat(profile: BrowserProfile, tabId: string, chatId: string | null): void {
  const next = new Map(chats);
  if (chatId === null) next.delete(tabKey(profile, tabId));
  else next.set(tabKey(profile, tabId), { chatId, startedAt: Date.now() });
  chats = next;
  listeners.forEach((listener) => listener());
}

export function useTabChats(): ReadonlyMap<string, TabChat> {
  return useSyncExternalStore(subscribe, () => chats);
}

export function tabChatOf(
  map: ReadonlyMap<string, TabChat>,
  profile: BrowserProfile,
  tabId: string | null,
): TabChat | null {
  return tabId === null ? null : (map.get(tabKey(profile, tabId)) ?? null);
}
