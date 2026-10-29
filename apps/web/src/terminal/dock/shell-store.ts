import { useSyncExternalStore } from 'react';
import type { CreateShellResponse, ShellFolderKind } from '@spark-outpost/contracts';
import { agentTerminalsApi } from '../../api/agent-terminals.ts';
import { previewApi } from '../../api/preview.ts';
import { createShell, runningCommand } from '../terminal-api.ts';
import { openTerminal, type TerminalConnection } from '../terminal-connection.ts';
import { endMessages } from '../terminal-messages.ts';
import { findCommandTab, type MirroredCommand } from './command-tabs.ts';

export type ShellStatus = 'starting' | 'open' | 'ended';
export type TabKind = 'shell' | 'preview' | 'command' | 'agent';

export interface ShellTab {
  id: string;
  sessionId: string | null;
  label: string | null;
  cwd: string | null;
  folder: ShellFolderKind | null;
  status: ShellStatus;
  notice: string | null;
  kind: TabKind;
  mirror: MirroredCommand | null;
  agentTerminalId: string | null;
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
const closedAgentTerminals = new Set<string>();
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

function shellFields(shell: CreateShellResponse): Partial<ShellTab> {
  return { sessionId: shell.id, label: shell.label, cwd: shell.cwd, folder: shell.kind };
}

function started(chatId: string, tabId: string, shell: CreateShellResponse) {
  updateTab(chatId, tabId, { ...shellFields(shell), status: 'open' });
  if (shell.note) connections.get(tabId)?.notice(shell.note);
}

function ended(chatId: string, tabId: string, notice: string, removeTab: boolean) {
  if (removeTab) {
    closeShell(chatId, tabId);
    return;
  }
  connections.get(tabId)?.notice(notice);
  updateTab(chatId, tabId, { status: 'ended', notice });
}

const PREVIEW_ENDED = 'The preview stopped.';

function addTab(
  chatId: string,
  kind: TabKind,
  front: boolean,
  mirror: MirroredCommand | null = null,
  agentTerminalId: string | null = null,
): string {
  const id = crypto.randomUUID();
  const host = document.createElement('div');
  host.className = 'term-host';
  parkHost(host);
  const tab: ShellTab = {
    id,
    sessionId: null,
    label: kind === 'preview' ? 'Preview' : null,
    cwd: null,
    folder: null,
    status: 'starting',
    notice: null,
    kind,
    mirror,
    agentTerminalId,
    host,
  };
  const chat = chatOf(chatId);
  const show = front || chat.activeId === null;
  if (show) focusWanted = id;
  setChat(chatId, {
    open: chat.open || front,
    tabs: [...chat.tabs, tab],
    activeId: show ? id : chat.activeId,
  });
  if (kind === 'command' || kind === 'agent') return id;
  const preview = kind === 'preview';
  const create = preview ? () => previewApi.terminal(chatId) : () => createShell(chatId);
  const connection = openTerminal(create, host, {
    startEarly: true,
    onCreated: (shell) => updateTab(chatId, id, shellFields(shell)),
    onOpen: (shell) => started(chatId, id, shell),
    onEnded: (reason) =>
      ended(chatId, id, preview ? PREVIEW_ENDED : endMessages[reason], reason === 'chat_removed'),
    onError: (message) => ended(chatId, id, message, false),
    onInputError: (notice) => updateTab(chatId, id, { notice }),
  });
  connections.set(id, connection);
  return id;
}

export function newShell(chatId: string): string {
  return addTab(chatId, 'shell', true);
}

export function showPreviewShell(chatId: string, front = true): void {
  const chat = chatOf(chatId);
  const existing = chat.tabs.find((tab) => tab.kind === 'preview' && tab.status !== 'ended');
  if (!existing) {
    for (const stale of chat.tabs.filter((tab) => tab.kind === 'preview')) {
      closeShell(chatId, stale.id);
    }
    addTab(chatId, 'preview', front);
    return;
  }
  if (!front) return;
  focusWanted = existing.id;
  setChat(chatId, { ...chat, open: true, activeId: existing.id });
}

export function openCommandTab(chatId: string, runId: string, commandId: string): void {
  const chat = chatOf(chatId);
  const mirror = { runId, commandId };
  const existing = findCommandTab(chat.tabs, mirror);
  if (!existing) {
    addTab(chatId, 'command', true, mirror);
    return;
  }
  focusWanted = existing.id;
  setChat(chatId, { ...chat, open: true, activeId: existing.id });
}

function agentTab(chatId: string, terminalId: string): ShellTab | null {
  return chatOf(chatId).tabs.find((tab) => tab.agentTerminalId === terminalId) ?? null;
}

export function openAgentTab(chatId: string, terminalId: string): void {
  closedAgentTerminals.delete(terminalId);
  const existing = agentTab(chatId, terminalId);
  if (!existing) {
    addTab(chatId, 'agent', true, null, terminalId);
    return;
  }
  focusWanted = existing.id;
  setChat(chatId, { ...chatOf(chatId), open: true, activeId: existing.id });
}

export function restoreAgentTabs(chatId: string, runningIds: readonly string[]): void {
  for (const terminalId of runningIds) {
    if (closedAgentTerminals.has(terminalId) || agentTab(chatId, terminalId)) continue;
    addTab(chatId, 'agent', false, null, terminalId);
  }
}

export function connectAgentTab(chatId: string, tabId: string, screen: HTMLElement): void {
  const tab = chatOf(chatId).tabs.find((other) => other.id === tabId);
  if (!tab?.agentTerminalId || connections.has(tabId)) return;
  const terminalId = tab.agentTerminalId;
  const failed = (notice: string) => {
    connections.get(tabId)?.dispose();
    connections.delete(tabId);
    updateTab(chatId, tabId, { sessionId: null, notice });
  };
  const connection = openTerminal(() => agentTerminalsApi.view(chatId, terminalId), screen, {
    readOnly: true,
    onOpen: (created) => updateTab(chatId, tabId, { sessionId: created.id, notice: null }),
    onEnded: () => undefined,
    onError: failed,
  });
  connections.set(tabId, connection);
}

export function retryAgentTab(chatId: string, tabId: string): void {
  updateTab(chatId, tabId, { notice: null });
}

export function syncCommandTab(
  chatId: string,
  tabId: string,
  seen: Pick<ShellTab, 'label' | 'cwd' | 'status'>,
): void {
  const tab = chatOf(chatId).tabs.find((other) => other.id === tabId);
  if (!tab || (tab.kind !== 'command' && tab.kind !== 'agent')) return;
  if (tab.label === seen.label && tab.cwd === seen.cwd && tab.status === seen.status) return;
  updateTab(chatId, tabId, seen);
}

export async function shellCommand(chatId: string, tabId: string): Promise<string | null> {
  const tab = chatOf(chatId).tabs.find((other) => other.id === tabId);
  if (tab?.status !== 'open' || !tab.sessionId || tab.kind === 'agent') return null;
  try {
    return await runningCommand(tab.sessionId);
  } catch {
    return null;
  }
}

export function closeShell(chatId: string, tabId: string, focusNext = false): void {
  const chat = chatOf(chatId);
  const index = chat.tabs.findIndex((tab) => tab.id === tabId);
  if (index === -1) return;
  const tab = chat.tabs[index]!;
  if (tab.agentTerminalId) closedAgentTerminals.add(tab.agentTerminalId);
  connections.get(tabId)?.dispose();
  connections.delete(tabId);
  tab.host.remove();
  const tabs = chat.tabs.filter((other) => other.id !== tabId);
  const neighbour = tabs[Math.min(index, tabs.length - 1)] ?? null;
  const activeId = chat.activeId === tabId ? (neighbour?.id ?? null) : chat.activeId;
  if (focusNext && activeId !== chat.activeId) focusWanted = activeId;
  setChat(chatId, { open: chat.open && tabs.length > 0, tabs, activeId });
  if (focusNext && activeId === chat.activeId && activeId) connections.get(activeId)?.focus();
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

export function attachedShell(tabId: string, host: HTMLElement): void {
  const connection = connections.get(tabId);
  if (focusWanted !== tabId) {
    connection?.fit();
    return;
  }
  const pane = host.querySelector<HTMLElement>('[data-mirror-focus]');
  if (connection && !pane) {
    focusWanted = null;
    connection.focus();
    return;
  }
  connection?.fit();
  pane?.focus();
  queueMicrotask(() => {
    if (focusWanted === tabId) focusWanted = null;
  });
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
