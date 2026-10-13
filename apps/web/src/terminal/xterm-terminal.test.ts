// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createTerminal } from './xterm-terminal.ts';

describe('createTerminal', () => {
  it('lets Option-drag select on a Mac and sends no arrow keys for an Option-click', () => {
    const terminal = createTerminal();
    expect(terminal.options.macOptionClickForcesSelection).toBe(true);
    expect(terminal.options.altClickMovesCursor).toBe(false);
    terminal.dispose();
  });

  it('keeps the option in a read-only terminal', () => {
    const terminal = createTerminal({ disableStdin: true, cursorBlink: false });
    expect(terminal.options.macOptionClickForcesSelection).toBe(true);
    terminal.dispose();
  });
});
