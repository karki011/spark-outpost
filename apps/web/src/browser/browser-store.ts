import { useSyncExternalStore } from 'react';
import {
  browserPaneStateSchema,
  browserPickSchema,
  type BrowserCommand,
  type BrowserPaneState,
  type BrowserPaneTab,
  type BrowserPick,
} from '@spark-outpost/contracts';
import { desktopBrowser } from '../desktop/desktop-bridge.ts';

export interface ChatBrowser {
  tabs: readonly BrowserPaneTab[];
  snapshot: string | null;
}

const EMPTY: ChatBrowser = { tabs: [], snapshot: null };

let chats: ReadonlyMap<string, ChatBrowser> = new Map();
const listeners = new Set<() => void>();
const pickListeners = new Set<(pick: BrowserPick) => void>();
let connected = false;

function emit(): void {
  for (const listener of listeners) listener();
}

function update(chatId: string, change: Partial<ChatBrowser>): void {
  const next = new Map(chats);
  next.set(chatId, { ...(chats.get(chatId) ?? EMPTY), ...change });
  chats = next;
  emit();
}

function accept(raw: unknown): void {
  const state = browserPaneStateSchema.safeParse(raw);
  if (state.success) update(state.data.chatId, { tabs: state.data.tabs });
}

function connect(): void {
  const browser = desktopBrowser();
  if (connected || !browser) return;
  connected = true;
  browser.onState(accept);
  browser.onSnapshot((snapshot) => {
    if (typeof snapshot?.chatId !== 'string') return;
    const image = typeof snapshot.image === 'string' ? snapshot.image : null;
    update(snapshot.chatId, { snapshot: image });
  });
  browser.onPicked((raw) => {
    const pick = browserPickSchema.safeParse(raw);
    if (!pick.success) return;
    for (const listener of pickListeners) listener(pick.data);
  });
}

function subscribe(listener: () => void): () => void {
  connect();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function browserAvailable(): boolean {
  return desktopBrowser() !== null;
}

export function useChatBrowser(chatId: string): ChatBrowser {
  return useSyncExternalStore(subscribe, () => chats.get(chatId) ?? EMPTY);
}

export function onBrowserPick(listener: (pick: BrowserPick) => void): () => void {
  connect();
  pickListeners.add(listener);
  return () => pickListeners.delete(listener);
}

export function acceptBrowserState(state: BrowserPaneState | null): void {
  if (state) accept(state);
}

export function sendBrowserCommand(chatId: string, command: BrowserCommand): void {
  void desktopBrowser()?.command(chatId, command);
}

export function activeTab(browser: ChatBrowser): BrowserPaneTab | null {
  return browser.tabs.find((tab) => tab.active) ?? null;
}
