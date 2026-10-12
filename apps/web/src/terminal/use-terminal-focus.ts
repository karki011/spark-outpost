import { useEffect, useRef, useState } from 'react';
import { useSidebarLayout } from '../conversations/sidebar-layout.tsx';
import { MAC } from '../ui/shortcuts.ts';

const FOCUS_KEY = 'spark-outpost.terminal.focus';

export interface FocusPanel {
  open: boolean;
  setOpen(open: boolean): void;
}

type FocusChord = Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'code'>;

export function isFocusShortcut(event: FocusChord, mac = MAC): boolean {
  const modifier = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  return modifier && event.shiftKey && !event.altKey && event.code === 'KeyF';
}

interface HiddenByFocus {
  sidebar: boolean;
  panel: boolean;
}

const NOTHING_HIDDEN: HiddenByFocus = { sidebar: false, panel: false };

function readFocused(): Record<string, HiddenByFocus> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(FOCUS_KEY) ?? '{}');
    if (typeof saved !== 'object' || saved === null || Array.isArray(saved)) return {};
    return Object.fromEntries(
      Object.entries(saved as Record<string, Partial<HiddenByFocus> | null>).map(([id, hid]) => [
        id,
        { sidebar: hid?.sidebar === true, panel: hid?.panel === true },
      ]),
    );
  } catch {
    return {};
  }
}

function saveFocused(chatId: string, hidden: HiddenByFocus | null): void {
  const others = Object.fromEntries(Object.entries(readFocused()).filter(([id]) => id !== chatId));
  try {
    localStorage.setItem(
      FOCUS_KEY,
      JSON.stringify(hidden ? { ...others, [chatId]: hidden } : others),
    );
  } catch {
    return;
  }
}

export function useTerminalFocus(chatId: string, panel: FocusPanel | null, available: boolean) {
  const sidebar = useSidebarLayout();
  const [focused, setFocused] = useState(() => chatId in readFocused());
  const hidden = useRef<HiddenByFocus>(readFocused()[chatId] ?? NOTHING_HIDDEN);
  const latest = useRef({ sidebar, panel });
  useEffect(() => {
    latest.current = { sidebar, panel };
  });
  const active = focused && available;
  const sidebarShown = sidebar !== null && !sidebar.narrow && !sidebar.collapsed;
  const panelOpen = panel?.open ?? false;

  useEffect(() => {
    if (!active) return;
    if (!sidebarShown && !panelOpen) return;
    hidden.current = {
      sidebar: hidden.current.sidebar || sidebarShown,
      panel: hidden.current.panel || panelOpen,
    };
    saveFocused(chatId, hidden.current);
    if (sidebarShown) latest.current.sidebar?.toggle();
    if (panelOpen) latest.current.panel?.setOpen(false);
  }, [active, chatId, sidebarShown, panelOpen]);

  useEffect(() => {
    if (!active) return;
    return () => {
      const now = latest.current;
      if (hidden.current.sidebar && now.sidebar && !now.sidebar.narrow) now.sidebar.reveal();
      if (hidden.current.panel) now.panel?.setOpen(true);
      hidden.current = NOTHING_HIDDEN;
      if (chatId in readFocused()) saveFocused(chatId, NOTHING_HIDDEN);
    };
  }, [active, chatId]);

  const setImmersive = sidebar?.setImmersive;
  useEffect(() => {
    if (!active || !setImmersive) return;
    setImmersive(true);
    return () => setImmersive(false);
  }, [active, setImmersive]);

  const toggle = () => {
    saveFocused(chatId, focused ? null : NOTHING_HIDDEN);
    setFocused(!focused);
  };
  const toggleRef = useRef(toggle);
  useEffect(() => {
    toggleRef.current = toggle;
  });

  useEffect(() => {
    if (!available) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isFocusShortcut(event)) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault();
      event.stopPropagation();
      toggleRef.current();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [available]);

  return { focused: active, toggle };
}
