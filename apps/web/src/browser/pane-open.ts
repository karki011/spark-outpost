import { useEffect, useMemo, useSyncExternalStore } from 'react';
import {
  browserAvailable,
  dismissAgentOpened,
  useAgentOpened,
  useHandoff,
} from './browser-store.ts';

const STORAGE_KEY = 'spark-outpost.browser-pane.open';
const REMEMBERED_CHATS = 100;

function readSaved(): readonly string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    if (!Array.isArray(saved)) return [];
    return saved.filter((id): id is string => typeof id === 'string').slice(-REMEMBERED_CHATS);
  } catch {
    return [];
  }
}

function save(chats: readonly string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(chats));
  } catch {
    return;
  }
}

let openChats: readonly string[] | null = null;
const listeners = new Set<() => void>();

function current(): readonly string[] {
  openChats ??= readSaved();
  return openChats;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function browserPaneOpen(chatId: string): boolean {
  return current().includes(chatId);
}

export function setBrowserPaneOpen(chatId: string, open: boolean): void {
  if (browserPaneOpen(chatId) === open) return;
  const others = current().filter((id) => id !== chatId);
  openChats = (open ? [...others, chatId] : others).slice(-REMEMBERED_CHATS);
  save(openChats);
  for (const listener of listeners) listener();
}

function useBrowserPaneOpen(chatId: string): boolean {
  return useSyncExternalStore(subscribe, () => browserPaneOpen(chatId));
}

export interface BrowserPaneChoice {
  open: boolean;
  setOpen(open: boolean): void;
}

export function useBrowserPane(chatId: string): BrowserPaneChoice | null {
  const open = useBrowserPaneOpen(chatId);
  const agentOpened = useAgentOpened(chatId);
  const handoff = useHandoff(chatId);

  useEffect(() => {
    if (agentOpened || handoff) setBrowserPaneOpen(chatId, true);
  }, [chatId, agentOpened, handoff]);

  return useMemo(() => {
    if (!browserAvailable()) return null;
    return {
      open,
      setOpen(next) {
        setBrowserPaneOpen(chatId, next);
        if (!next) dismissAgentOpened(chatId);
      },
    };
  }, [chatId, open]);
}
