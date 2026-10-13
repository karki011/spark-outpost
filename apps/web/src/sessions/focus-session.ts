const MESSAGE_BOX = '.main .composer textarea';
const TERMINAL_INPUT = '.main .native-screen .xterm-helper-textarea';
const FOCUS_TRIES = 180;

function focusIsFree(terminal: boolean): boolean {
  const focused = document.activeElement;
  if (!focused || focused === document.body) return true;
  return terminal && focused.matches(MESSAGE_BOX);
}

export function focusOpenedSession(terminal: boolean, tries = FOCUS_TRIES): void {
  requestAnimationFrame(() => {
    if (!focusIsFree(terminal)) return;
    const input = document.querySelector<HTMLElement>(terminal ? TERMINAL_INPUT : MESSAGE_BOX);
    if (input) input.focus({ preventScroll: true });
    else if (tries > 0) focusOpenedSession(terminal, tries - 1);
  });
}
