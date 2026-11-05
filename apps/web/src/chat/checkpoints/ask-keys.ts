export type AskTarget = 'option' | 'radio' | 'answer' | 'other';

export interface AskKey {
  key: string;
  shift: boolean;
  modifier: boolean;
  composing: boolean;
  target: AskTarget;
  caretAtStart: boolean;
}

export type AskKeyAction =
  | { kind: 'send' }
  | { kind: 'onward' }
  | { kind: 'move'; by: 1 | -1 }
  | { kind: 'pick'; index: number };

function enterAction(pressed: AskKey): AskKeyAction | null {
  if (pressed.modifier) return { kind: 'send' };
  if (pressed.shift) return null;
  if (pressed.target === 'other') return null;
  return { kind: 'onward' };
}

const FORWARD = new Set(['ArrowDown', 'ArrowRight']);
const SIDE_ARROWS = new Set(['ArrowLeft', 'ArrowRight']);

function arrowAction(pressed: AskKey): AskKeyAction | null {
  if (pressed.modifier || pressed.shift) return null;
  if (pressed.target === 'option' || pressed.target === 'radio') {
    return { kind: 'move', by: FORWARD.has(pressed.key) ? 1 : -1 };
  }
  const leavesField = pressed.key === 'ArrowUp' && pressed.caretAtStart;
  return pressed.target === 'answer' && leavesField ? { kind: 'move', by: -1 } : null;
}

export function askKeyAction(pressed: AskKey): AskKeyAction | null {
  if (pressed.composing) return null;
  if (pressed.key === 'Enter') return enterAction(pressed);
  if (pressed.key === 'ArrowDown' || pressed.key === 'ArrowUp') return arrowAction(pressed);
  if (SIDE_ARROWS.has(pressed.key) && pressed.target === 'radio') return arrowAction(pressed);
  if (pressed.target === 'answer' || pressed.modifier || !/^[1-9]$/.test(pressed.key)) return null;
  return { kind: 'pick', index: Number(pressed.key) - 1 };
}
