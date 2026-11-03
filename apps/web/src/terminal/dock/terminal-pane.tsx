import { useEffect, type RefObject } from 'react';
import type { ChatMenuPane } from '../../audit/ChatHeaderMenu.tsx';
import { TerminalIcon } from '../../ui/icons.tsx';
import { TERMINAL_KEYS } from '../../ui/Keys.tsx';
import { preloadTerminal } from '../terminal-connection.ts';
import { toggleShells, useChatShells } from './shell-store.ts';
import { usePaneFocused, usePaneId } from '../../chat/split/chat-pane.ts';

export const TERMINAL_DOCK_ID = 'terminal-dock';
export const TERMINAL_DOCK_SELECTOR = '.term-dock';

function isTerminalShortcut(event: KeyboardEvent): boolean {
  return event.ctrlKey && !event.metaKey && !event.altKey && event.code === 'Backquote';
}

function useTerminalShortcut(
  chatId: string,
  anchor: RefObject<HTMLElement | null>,
  enabled: boolean,
) {
  const focused = usePaneFocused();
  useEffect(() => {
    if (!enabled || !focused) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTerminalShortcut(event)) return;
      const target = anchor.current;
      if (!target || target.closest('[hidden]')) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault();
      event.stopPropagation();
      const fromDock = document.activeElement?.closest(TERMINAL_DOCK_SELECTOR);
      toggleShells(chatId);
      if (fromDock) target.focus();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [chatId, anchor, enabled, focused]);
}

function warmTerminal() {
  void preloadTerminal().catch(() => undefined);
}

export function useTerminalPane(
  chatId: string,
  anchor: RefObject<HTMLElement | null>,
  enabled: boolean,
): ChatMenuPane | null {
  const shells = useChatShells(chatId);
  const dockId = usePaneId(TERMINAL_DOCK_ID);
  useTerminalShortcut(chatId, anchor, enabled);
  if (!enabled) return null;
  const running = !shells.open && shells.tabs.some((tab) => tab.status !== 'ended');
  return {
    label: 'Terminal',
    icon: <TerminalIcon />,
    open: shells.open,
    keys: TERMINAL_KEYS,
    ariaKeys: 'Control+`',
    ...(shells.open ? { controls: dockId } : {}),
    signal: running ? { note: 'Running', summary: 'Terminal running', live: false } : null,
    onToggle: () => toggleShells(chatId),
    onIntent: warmTerminal,
  };
}
