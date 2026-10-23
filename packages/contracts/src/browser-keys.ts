import { z } from 'zod';

export const BROWSER_SHORTCUTS = [
  'copy_url',
  'new_tab',
  'close_tab',
  'reopen_tab',
  'focus_address',
  'reload',
  'hard_reload',
  'back',
  'forward',
  'tab_1',
  'tab_2',
  'tab_3',
  'tab_4',
  'tab_5',
  'tab_6',
  'tab_7',
  'tab_8',
  'last_tab',
  'next_tab',
  'previous_tab',
  'find',
  'new_chat',
  'ask_spark',
] as const;
export type BrowserShortcut = (typeof BROWSER_SHORTCUTS)[number];

export const browserShortcutEventSchema = z.object({
  chatId: z.uuid(),
  shortcut: z.enum(BROWSER_SHORTCUTS),
});
export type BrowserShortcutEvent = z.infer<typeof browserShortcutEventSchema>;

export const BROWSER_FOCUS_SHORTCUTS: ReadonlySet<BrowserShortcut> = new Set([
  'new_tab',
  'focus_address',
  'find',
  'new_chat',
  'ask_spark',
]);

export interface ShortcutChord {
  code: string;
  meta: boolean;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  composing: boolean;
}

const PLAIN: Record<string, BrowserShortcut> = {
  KeyT: 'new_tab',
  KeyW: 'close_tab',
  KeyL: 'focus_address',
  KeyR: 'reload',
  KeyF: 'find',
  BracketLeft: 'back',
  BracketRight: 'forward',
  Digit1: 'tab_1',
  Digit2: 'tab_2',
  Digit3: 'tab_3',
  Digit4: 'tab_4',
  Digit5: 'tab_5',
  Digit6: 'tab_6',
  Digit7: 'tab_7',
  Digit8: 'tab_8',
  Digit9: 'last_tab',
};

const SHIFTED: Record<string, BrowserShortcut> = {
  KeyC: 'copy_url',
  KeyT: 'reopen_tab',
  KeyR: 'hard_reload',
  KeyO: 'new_chat',
};

const OPTIONED: Record<string, BrowserShortcut> = {
  KeyA: 'ask_spark',
};

function tabSwitch(chord: ShortcutChord): BrowserShortcut | null {
  if (chord.code !== 'Tab' || !chord.ctrl || chord.meta || chord.alt) return null;
  return chord.shift ? 'previous_tab' : 'next_tab';
}

export function browserShortcut(chord: ShortcutChord, mac: boolean): BrowserShortcut | null {
  if (chord.composing) return null;
  const switched = tabSwitch(chord);
  if (switched) return switched;
  const primary = mac ? chord.meta && !chord.ctrl : chord.ctrl && !chord.meta;
  if (!primary) return null;
  if (chord.alt) return chord.shift ? null : (OPTIONED[chord.code] ?? null);
  return (chord.shift ? SHIFTED[chord.code] : PLAIN[chord.code]) ?? null;
}

export function shortcutTabIndex(
  shortcut: BrowserShortcut,
  current: number,
  count: number,
): number | null {
  if (count === 0) return null;
  if (shortcut === 'last_tab') return count - 1;
  if (shortcut === 'next_tab') return (current + 1) % count;
  if (shortcut === 'previous_tab') return (current - 1 + count) % count;
  const number = /^tab_(\d)$/.exec(shortcut);
  if (!number) return null;
  const index = Number(number[1]) - 1;
  return index < count ? index : null;
}
