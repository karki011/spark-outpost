import type { Terminal } from '@xterm/xterm';

export const MOUSE_REPORTING_OFF = '\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1004l\x1b[?1006l';

type ModesTerminal = Pick<Terminal, 'modes' | 'onWriteParsed'>;

export function followMouseReporting(
  terminal: ModesTerminal,
  onChange: ((on: boolean) => void) | undefined,
): () => void {
  if (!onChange) return () => undefined;
  let on = false;
  const subscription = terminal.onWriteParsed(() => {
    const next = terminal.modes.mouseTrackingMode !== 'none';
    if (next === on) return;
    on = next;
    onChange(next);
  });
  return () => subscription.dispose();
}
