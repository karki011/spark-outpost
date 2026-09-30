import { useSyncExternalStore } from 'react';
import type { CreateShellResponse, ShellFolderKind } from '@spark-outpost/contracts';
import { createShell } from '../terminal-api.ts';
import { openTerminal, type TerminalConnection } from '../terminal-connection.ts';
import { endMessages } from '../terminal-messages.ts';

export type ShellStatus = 'starting' | 'open' | 'ended';

export interface ShellTab {
  id: string;
  label: string | null;
  cwd: string | null;
  kind: ShellFolderKind | null;
  status: ShellStatus;
  notice: string | null;
  host: HTMLDivElement;
}

export interface ChatShells {
  open: boolean;
  tabs: readonly ShellTab[];
  activeId: string | null;
}

const EMPTY: ChatShells = { open: false, tabs: [], activeId: null };

let chats: ReadonlyMap<string, ChatShells> = new Map();
const connections = new Map<string, TerminalConnection>();
const listeners = new Set<() => void>();
let park: HTMLDivElement | null = null;
let focusWanted: string | null = null;

function emit() {
  for (const listener of listeners) listener();
}

export function chatOf(chatId: string): ChatShells {
  return chats.get(chatId) ?? EMPTY;
}

function setChat(chatId: string, next: ChatShells) {
  const copy = new Map(chats);
  if (next.tabs.length === 0 && !next.open) copy.delete(chatId);
  else copy.set(chatId, next);
  chats = copy;
  emit();
}

function updateTab(chatId: string, tabId: string, change: Partial<ShellTab>) {
  const chat = chatOf(chatId);
  if (!chat.tabs.some((tab) => tab.id === tabId)) return;
  setChat(chatId, {
    ...chat,
    tabs: chat.tabs.map((tab) => (tab.id === tabId ? { ...tab, ...change } : tab)),
  });
}

function parking(): HTMLDivElement {
  if (park?.isConnected) return park;
  park = document.createElement('div');
  park.className = 'term-park';
  park.setAttribute('aria-hidden', 'true');
  document.body.append(park);
  return park;
}

export function parkHost(host: HTMLDivElement): void {
  parking().append(host);
}

function started(chatId: string, tabId: string, created: CreateShellResponse) {
  updateTab(chatId, tabId, {
    label: created.label,
    cwd: created.cwd,
    kind: created.kind,
    status: 'open',
  });
  if (created.note) connections.get(tabId)?.notice(created.note);
}

function ended(chatId: string, tabId: string, notice: string, removeTab: boolean) {
  if (removeTab) {
    closeShell(chatId, tabId);
    return;
  }
  connections.get(tabId)?.notice(notice);
  updateTab(chatId, tabId, { status: 'ended', notice });
}

export function newShell(chatId: string): string {
  const id = crypto.randomUUID();
  const host = document.createElement('div');
  host.className = 'term-host';
  parkHost(host);
  const tab: ShellTab = {
    id,
    label: null,
    cwd: null,
    kind: null,
    status: 'starting',
    notice: null,
    host,
  };
  const chat = chatOf(chatId);
  focusWanted = id;
  setChat(chatId, { open: true, tabs: [...chat.tabs, tab], activeId: id });
  const connection = openTerminal(() => createShell(chatId), host, {
    onOpen: (created) => started(chatId, id, created),
    onEnded: (reason) => ended(chatId, id, endMessages[reason], reason === 'chat_removed'),
    onError: (message) => ended(chatId, id, message, false),
  });
  connections.set(id, connection);
  return id;
}

export function closeShell(chatId: string, tabId: string): void {
  const chat = chatOf(chatId);
  const index = chat.tabs.findIndex((tab) => tab.id === tabId);
  if (index === -1) return;
  const tab = chat.tabs[index]!;
  connections.get(tabId)?.dispose();
  connections.delete(tabId);
  tab.host.remove();
  const tabs = chat.tabs.filter((other) => other.id !== tabId);
  const neighbour = tabs[Math.min(index, tabs.length - 1)] ?? null;
  const activeId = chat.activeId === tabId ? (neighbour?.id ?? null) : chat.activeId;
  setChat(chatId, { open: chat.open && tabs.length > 0, tabs, activeId });
}

export function selectShell(chatId: string, tabId: string): void {
  const chat = chatOf(chatId);
  if (!chat.tabs.some((tab) => tab.id === tabId)) return;
  focusWanted = tabId;
  setChat(chatId, { ...chat, activeId: tabId });
}

export function showShells(chatId: string): void {
  const chat = chatOf(chatId);
  if (chat.tabs.length === 0) {
    newShell(chatId);
    return;
  }
  focusWanted = chat.activeId;
  setChat(chatId, { ...chat, open: true });
}

export function hideShells(chatId: string): void {
  const chat = chatOf(chatId);
  if (chat.open) setChat(chatId, { ...chat, open: false });
}

export function toggleShells(chatId: string): void {
  if (chatOf(chatId).open) hideShells(chatId);
  else showShells(chatId);
}

export function attachedShell(tabId: string): void {
  const connection = connections.get(tabId);
  if (focusWanted !== tabId) {
    connection?.fit();
    return;
  }
  focusWanted = null;
  connection?.focus();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useChatShells(chatId: string): ChatShells {
  return useSyncExternalStore(subscribe, () => chatOf(chatId));
}
