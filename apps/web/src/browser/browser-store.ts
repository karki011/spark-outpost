import { useSyncExternalStore } from 'react';
import {
  browserPaneStateSchema,
  browserPickSchema,
  browserSelectedTextSchema,
  type BrowserCommand,
  type BrowserPaneState,
  type BrowserPaneTab,
  type BrowserPick,
  type BrowserSelectedText,
} from '@spark-outpost/contracts';
import { desktopBrowser } from '../desktop/desktop-bridge.ts';

export interface ChatBrowser {
  tabs: readonly BrowserPaneTab[];
  snapshot: string | null;
  agentOpened: string | null;
  notice: string | null;
}

const EMPTY: ChatBrowser = { tabs: [], snapshot: null, agentOpened: null, notice: null };

let chats: ReadonlyMap<string, ChatBrowser> = new Map();
const listeners = new Set<() => void>();
const pickListeners = new Set<(pick: BrowserPick) => void>();
const textListeners = new Set<(selected: BrowserSelectedText) => void>();
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

export function agentOpenedTab(
  before: ChatBrowser,
  tabs: readonly BrowserPaneTab[],
): string | null {
  const known = new Set(before.tabs.map((tab) => tab.id));
  const opened = tabs.find((tab) => tab.owner === 'agent' && tab.driving && !known.has(tab.id));
  if (opened) return opened.id;
  return tabs.some((tab) => tab.id === before.agentOpened) ? before.agentOpened : null;
}

function accept(raw: unknown, pushed: boolean): void {
  const state = browserPaneStateSchema.safeParse(raw);
  if (!state.success) return;
  const { chatId, tabs } = state.data;
  const before = chats.get(chatId) ?? EMPTY;
  const agentOpened = agentOpenedTab(pushed ? before : { ...before, tabs }, tabs);
  update(chatId, { tabs, agentOpened });
}

function connect(): void {
  const browser = desktopBrowser();
  if (connected || !browser) return;
  connected = true;
  browser.onState((state) => accept(state, true));
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
  browser.onSelectedText((raw) => {
    const selected = browserSelectedTextSchema.safeParse(raw);
    if (!selected.success) return;
    for (const listener of textListeners) listener(selected.data);
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

export function knownTabs(chatId: string): readonly BrowserPaneTab[] {
  return chats.get(chatId)?.tabs ?? EMPTY.tabs;
}

export function useAgentOpened(chatId: string): string | null {
  return useSyncExternalStore(subscribe, () => chats.get(chatId)?.agentOpened ?? null);
}

export function useHandoff(chatId: string): string | null {
  return useSyncExternalStore(
    subscribe,
    () => chats.get(chatId)?.tabs.find((tab) => tab.handoff)?.handoff?.approvalId ?? null,
  );
}

export function onBrowserPick(listener: (pick: BrowserPick) => void): () => void {
  connect();
  pickListeners.add(listener);
  return () => pickListeners.delete(listener);
}

export function onBrowserText(listener: (selected: BrowserSelectedText) => void): () => void {
  connect();
  textListeners.add(listener);
  return () => textListeners.delete(listener);
}

export function setPaneNotice(chatId: string, notice: string | null): void {
  if ((chats.get(chatId)?.notice ?? null) !== notice) update(chatId, { notice });
}

export function acceptBrowserState(state: BrowserPaneState | null): void {
  if (state) accept(state, false);
}

export function dismissAgentOpened(chatId: string): void {
  if (chats.get(chatId)?.agentOpened) update(chatId, { agentOpened: null });
}

export function sendBrowserCommand(chatId: string, command: BrowserCommand): void {
  void desktopBrowser()?.command(chatId, command);
}

export function activeTab(browser: ChatBrowser): BrowserPaneTab | null {
  return browser.tabs.find((tab) => tab.active) ?? null;
}
