import { describe, expect, it, vi } from 'vitest';
import { refitWhenFontLoads, TERMINAL_FONT } from './terminal-font.ts';

function fonts(loaded: boolean) {
  let finish: () => void = () => undefined;
  const load = vi.fn(
    () =>
      new Promise<FontFace[]>((resolve) => {
        finish = () => resolve([]);
      }),
  );
  return { set: { check: () => loaded, load }, finish: () => finish() };
}

describe('refitWhenFontLoads', () => {
  it('measures again and refits once the terminal font has loaded', async () => {
    const terminal = { options: { fontFamily: TERMINAL_FONT } };
    const refit = vi.fn();
    const pending = fonts(false);
    refitWhenFontLoads(terminal, () => true, refit, pending.set);
    expect(refit).not.toHaveBeenCalled();
    pending.finish();
    await vi.waitFor(() => expect(refit).toHaveBeenCalledTimes(1));
    expect(terminal.options.fontFamily).not.toBe(TERMINAL_FONT);
    expect(terminal.options.fontFamily.startsWith(TERMINAL_FONT)).toBe(true);
  });

  it('does nothing when the font was ready before the terminal opened', () => {
    const terminal = { options: { fontFamily: TERMINAL_FONT } };
    const ready = fonts(true);
    refitWhenFontLoads(terminal, () => true, vi.fn(), ready.set);
    expect(ready.set.load).not.toHaveBeenCalled();
  });

  it('leaves a terminal that closed before the font loaded alone', async () => {
    const terminal = { options: { fontFamily: TERMINAL_FONT } };
    const refit = vi.fn();
    const pending = fonts(false);
    refitWhenFontLoads(terminal, () => false, refit, pending.set);
    pending.finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(refit).not.toHaveBeenCalled();
    expect(terminal.options.fontFamily).toBe(TERMINAL_FONT);
  });
});
