// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createTerminal, followTheme } from './xterm-terminal.ts';

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

describe('followTheme', () => {
  it('says when the theme changes, until it is told to stop', async () => {
    const terminal = createTerminal();
    const changed = vi.fn();
    const stop = followTheme(terminal, changed);
    document.documentElement.dataset.skin = 'apricot';
    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
    stop();
    document.documentElement.dataset.skin = 'graphite';
    await new Promise((done) => setTimeout(done, 20));
    expect(changed).toHaveBeenCalledTimes(1);
    delete document.documentElement.dataset.skin;
    terminal.dispose();
  });
});
