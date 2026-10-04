import { useEffect, useRef, type RefObject } from 'react';
import { TERMINAL_KEYS } from '../../ui/Keys.tsx';
import { useTooltip } from '../../ui/Tooltip.tsx';
import { preloadTerminal } from '../terminal-connection.ts';
import { toggleShells, useChatShells } from './shell-store.ts';

export const TERMINAL_DOCK_ID = 'terminal-dock';
export const TERMINAL_BUTTON_ID = 'terminal-button';

export function isTerminalShortcut(event: KeyboardEvent): boolean {
  return event.ctrlKey && !event.metaKey && !event.altKey && event.code === 'Backquote';
}

function useTerminalShortcut(chatId: string, button: RefObject<HTMLButtonElement | null>) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTerminalShortcut(event)) return;
      const target = button.current;
      if (!target || target.closest('[hidden]')) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault();
      event.stopPropagation();
      const fromDock = document.activeElement?.closest(`#${TERMINAL_DOCK_ID}`);
      toggleShells(chatId);
      if (fromDock) target.focus();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [chatId, button]);
}

function warmTerminal() {
  void preloadTerminal().catch(() => undefined);
}

export function TerminalButton({ chatId }: { chatId: string }) {
  const shells = useChatShells(chatId);
  const button = useRef<HTMLButtonElement>(null);
  const tip = useTooltip('Terminal', { keys: TERMINAL_KEYS });
  useTerminalShortcut(chatId, button);
  const running = !shells.open && shells.tabs.some((tab) => tab.status !== 'ended');
  return (
    <>
      <button
        ref={button}
        id={TERMINAL_BUTTON_ID}
        type="button"
        className={running ? 'icon-btn term-btn running' : 'icon-btn term-btn'}
        aria-label="Terminal"
        aria-pressed={shells.open}
        aria-keyshortcuts="Control+`"
        aria-controls={shells.open ? TERMINAL_DOCK_ID : undefined}
        {...tip.triggerProps}
        onMouseEnter={warmTerminal}
        onFocusCapture={warmTerminal}
        onClick={() => toggleShells(chatId)}
      >
        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="3" y="4" width="18" height="16" rx="3" />
          <path d="m7.5 9.5 3 2.5-3 2.5M13 15h3.5" />
        </svg>
      </button>
      {tip.tooltip}
    </>
  );
}
