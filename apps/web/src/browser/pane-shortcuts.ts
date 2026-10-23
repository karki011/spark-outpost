import { useEffect, useRef, type KeyboardEvent } from 'react';
import {
  browserShortcut,
  browserShortcutEventSchema,
  shortcutTabIndex,
  type BrowserCommand,
  type BrowserPaneTab,
  type BrowserShortcut,
} from '@spark-outpost/contracts';
import { desktopBrowser } from '../desktop/desktop-bridge.ts';
import type { ShortcutKeys } from '../ui/Keys.tsx';
import { MAC } from '../ui/shortcuts.ts';
import { closeBrowserTab, sendBrowserCommand } from './browser-store.ts';

export interface PaneKeys {
  shown: ShortcutKeys;
  aria: string;
}

function paneKeys(key: string, shift = false): PaneKeys {
  const label = key === 'BracketLeft' ? '[' : key === 'BracketRight' ? ']' : key;
  const shown = MAC
    ? ['⌘', ...(shift ? ['⇧'] : []), label]
    : ['Ctrl', ...(shift ? ['Shift'] : []), label];
  const aria = [MAC ? 'Meta' : 'Control', ...(shift ? ['Shift'] : []), label].join('+');
  return { shown, aria };
}

export const PANE_KEYS = {
  back: paneKeys('BracketLeft'),
  forward: paneKeys('BracketRight'),
  reload: paneKeys('R'),
  newTab: paneKeys('T'),
  close: paneKeys('W'),
};

export interface PaneCommands {
  send(command: BrowserCommand): void;
  close(tabId: string): void;
}

export function chatPaneCommands(chatId: string): PaneCommands {
  return {
    send: (command) => sendBrowserCommand(chatId, command),
    close: (tabId) => void closeBrowserTab(chatId, tabId),
  };
}

export interface PaneShortcutUi {
  focusAddress(): void;
  openFind(): void;
  copiedUrl(): void;
  newChat?(): void;
  askSpark?(): void;
}

const HISTORY: Partial<Record<BrowserShortcut, 'reload' | 'hard_reload' | 'back' | 'forward'>> = {
  reload: 'reload',
  hard_reload: 'hard_reload',
  back: 'back',
  forward: 'forward',
};

export function runPaneShortcut(
  commands: PaneCommands,
  tabs: readonly BrowserPaneTab[],
  shortcut: BrowserShortcut,
  ui: PaneShortcutUi,
): void {
  const current = tabs.findIndex((tab) => tab.active);
  const tab = tabs[current] ?? null;
  const page = tab !== null && tab.url !== '';
  const history = HISTORY[shortcut];
  if (shortcut === 'new_tab') commands.send({ command: 'new_tab', url: null });
  else if (shortcut === 'reopen_tab') commands.send({ command: 'reopen' });
  else if (shortcut === 'focus_address') ui.focusAddress();
  else if (shortcut === 'new_chat') ui.newChat?.();
  else if (shortcut === 'ask_spark') ui.askSpark?.();
  else if (shortcut === 'close_tab') {
    if (tab) commands.close(tab.id);
  } else if (shortcut === 'copy_url') {
    if (!page) return;
    commands.send({ command: 'copy_url', tabId: tab.id });
    ui.copiedUrl();
  } else if (shortcut === 'find') {
    if (page && tab.error === null) ui.openFind();
  } else if (history) {
    if (page) commands.send({ command: history, tabId: tab.id });
  } else {
    const index = shortcutTabIndex(shortcut, current, tabs.length);
    const target = index === null ? null : tabs[index];
    if (target) commands.send({ command: 'select', tabId: target.id });
  }
}

export function chromeShortcut(event: KeyboardEvent<HTMLElement>): BrowserShortcut | null {
  return browserShortcut(
    {
      code: event.code,
      meta: event.metaKey,
      ctrl: event.ctrlKey,
      shift: event.shiftKey,
      alt: event.altKey,
      composing: event.nativeEvent.isComposing || event.keyCode === 229,
    },
    MAC,
  );
}

export function usePageShortcuts(
  chatId: string,
  run: (shortcut: BrowserShortcut) => void,
  enabled: boolean,
): void {
  const latest = useRef(run);
  useEffect(() => {
    latest.current = run;
  });
  useEffect(() => {
    const browser = desktopBrowser();
    if (!enabled || !browser) return;
    return browser.onShortcut((raw) => {
      const event = browserShortcutEventSchema.safeParse(raw);
      if (event.success && event.data.chatId === chatId) latest.current(event.data.shortcut);
    });
  }, [chatId, enabled]);
}
