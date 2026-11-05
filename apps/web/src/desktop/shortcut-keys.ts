const MODIFIER_LABELS: Record<string, string> = {
  Command: '⌘',
  Cmd: '⌘',
  CommandOrControl: '⌘',
  CmdOrCtrl: '⌘',
  Control: '⌃',
  Ctrl: '⌃',
  Alt: '⌥',
  Option: '⌥',
  Shift: '⇧',
};

const CODE_KEYS: Record<string, string> = {
  Space: 'Space',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
};

export function shortcutKeys(accelerator: string): string[] {
  return accelerator.split('+').map((part) => MODIFIER_LABELS[part] ?? part);
}

export function shortcutLabel(accelerator: string): string {
  return shortcutKeys(accelerator).join(' ');
}

function keyName(code: string): string | null {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1]!;
  const digit = /^Digit([0-9])$/.exec(code);
  if (digit) return digit[1]!;
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  return CODE_KEYS[code] ?? null;
}

export interface KeyPress {
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export function acceleratorFromKey(press: KeyPress): string | null {
  const key = keyName(press.code);
  if (!key) return null;
  const modifiers = [
    press.metaKey ? 'Command' : null,
    press.ctrlKey ? 'Control' : null,
    press.altKey ? 'Alt' : null,
    press.shiftKey ? 'Shift' : null,
  ].filter((part): part is string => part !== null);
  if (modifiers.length === 0) return null;
  if (modifiers.length === 1 && modifiers[0] === 'Shift') return null;
  return [...modifiers, key].join('+');
}

export function matchesShortcut(accelerator: string, press: KeyPress): boolean {
  return acceleratorFromKey(press) === accelerator;
}
