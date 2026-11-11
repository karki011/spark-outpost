import { useEffect, useRef } from 'react';
import { keysText } from '../ui/Keys.tsx';
import { MAC } from '../ui/shortcuts.ts';
import type { AppView } from './Rail.tsx';

export const RAIL_SHORTCUT_COUNT = 9;

type RailChord = Pick<
  KeyboardEvent,
  'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'repeat' | 'isComposing'
> & { getModifierState: (key: string) => boolean };

export function railShortcutNumber(event: RailChord, mac: boolean): number | null {
  if (event.repeat || event.isComposing || event.shiftKey || !event.altKey) return null;
  if (event.getModifierState('AltGraph')) return null;
  const modifier = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (!modifier) return null;
  const digit = /^Digit([1-9])$/.exec(event.code);
  return digit ? Number(digit[1]) : null;
}

export function railHint(number: number): string | undefined {
  if (number > RAIL_SHORTCUT_COUNT) return undefined;
  return keysText(MAC ? ['⌥', '⌘', String(number)] : ['Ctrl', 'Alt', String(number)]);
}

export function railAriaKeys(number: number): string | undefined {
  if (number > RAIL_SHORTCUT_COUNT) return undefined;
  return MAC ? `Alt+Meta+${number}` : `Control+Alt+${number}`;
}

export function railTitle(label: string, number: number): string {
  const hint = railHint(number);
  return hint ? `${label} · ${hint}` : label;
}

export function useRailShortcuts(views: readonly AppView[], onView: (view: AppView) => void): void {
  const latest = useRef({ views, onView });
  useEffect(() => {
    latest.current = { views, onView };
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const number = railShortcutNumber(event, MAC);
      if (number === null) return;
      const target = latest.current.views[number - 1];
      if (!target) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault();
      latest.current.onView(target);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
