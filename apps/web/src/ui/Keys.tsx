import './keys.css';
import { MAC } from './shortcuts.ts';

export type ShortcutKeys = readonly string[];

export const NEW_CHAT_KEYS: ShortcutKeys = MAC ? ['⌘', '⇧', 'O'] : ['Ctrl', 'Shift', 'O'];
export const ASK_TABS_KEYS: ShortcutKeys = MAC ? ['⌥', '⌘', 'A'] : ['Ctrl', 'Alt', 'A'];
export const SEARCH_KEYS: ShortcutKeys = MAC ? ['⌘', 'K'] : ['Ctrl', 'K'];
export const PALETTE_KEYS: ShortcutKeys = MAC ? ['⌘', '⇧', 'K'] : ['Ctrl', 'Shift', 'K'];
export const SIDEBAR_KEYS: ShortcutKeys = MAC ? ['⌃', '⌘', 'S'] : ['Ctrl', 'Alt', 'S'];
export const DIFF_KEYS: ShortcutKeys = MAC ? ['⌘', 'D'] : ['Ctrl', 'D'];
export const BROWSER_KEYS: ShortcutKeys = MAC ? ['⌘', '⇧', 'B'] : ['Ctrl', 'Shift', 'B'];
export const TERMINAL_KEYS: ShortcutKeys = MAC ? ['⌃', '`'] : ['Ctrl', '`'];
export const TERMINAL_FOCUS_KEYS: ShortcutKeys = MAC ? ['⌘', '⇧', 'F'] : ['Ctrl', 'Shift', 'F'];
export const WAITING_KEYS: ShortcutKeys = MAC ? ['⌘', '⇧', 'Y'] : ['Ctrl', 'Shift', 'Y'];

export function keysText(keys: ShortcutKeys): string {
  return keys.join(MAC ? '' : ' ');
}

export function Keys({ keys, className }: { keys: ShortcutKeys; className?: string }) {
  return (
    <span className={className ? `keys ${className}` : 'keys'} aria-hidden="true">
      {keys.map((key) => (
        <kbd key={key}>{key}</kbd>
      ))}
    </span>
  );
}
