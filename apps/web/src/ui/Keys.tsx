import './keys.css';
import { MAC } from './shortcuts.ts';

export type ShortcutKeys = readonly string[];

export const NEW_CHAT_KEYS: ShortcutKeys = MAC ? ['⌘', '⇧', 'O'] : ['Ctrl', 'Shift', 'O'];
export const SEARCH_KEYS: ShortcutKeys = MAC ? ['⌘', 'K'] : ['Ctrl', 'K'];
export const SIDEBAR_KEYS: ShortcutKeys = MAC ? ['⌘', 'B'] : ['Ctrl', 'B'];

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
