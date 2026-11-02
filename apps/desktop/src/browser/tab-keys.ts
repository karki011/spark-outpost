import type { Input } from 'electron';
import {
  browserShortcut,
  type BrowserShortcut,
  type ShortcutChord,
} from '@spark-outpost/contracts';

const MENU_SHORTCUTS: ReadonlySet<BrowserShortcut> = new Set([
  'close_tab',
  'reload',
  'hard_reload',
  'zoom_in',
  'zoom_out',
  'zoom_reset',
  'print',
]);

export function chordOf(input: Input): ShortcutChord {
  return {
    code: input.code,
    meta: input.meta,
    ctrl: input.control,
    shift: input.shift,
    alt: input.alt,
    composing: input.isComposing,
  };
}

export function paneShortcutOf(input: Input): BrowserShortcut | null {
  const shortcut = browserShortcut(chordOf(input), process.platform === 'darwin');
  return shortcut && !MENU_SHORTCUTS.has(shortcut) ? shortcut : null;
}
