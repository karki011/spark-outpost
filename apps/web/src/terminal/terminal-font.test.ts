// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { refitWhenFontLoads, terminalFont, warmTerminalFont } from './terminal-font.ts';

const FONT = "'SF Mono', Menlo, monospace";

function fontSet(ready: boolean) {
  const pending: (() => void)[] = [];
  const listeners = new Set<(event: Event) => void>();
  const load = vi.fn(
    (spec: string) =>
      new Promise<FontFace[]>((resolve) => {
        pending.push(() => resolve([]));
        void spec;
      }),
  );
  return {
    set: {
      check: () => ready,
      load,
      addEventListener: (_type: string, listener: (event: Event) => void) =>
        void listeners.add(listener),
      removeEventListener: (_type: string, listener: (event: Event) => void) =>
        void listeners.delete(listener),
    } as never,
    load,
    finish: () => pending.forEach((resolve) => resolve()),
    faceLoaded: (family: string) =>
      listeners.forEach((listener) => listener({ fontfaces: [{ family }] } as never)),
  };
}

function terminal() {
  return { options: { fontFamily: FONT }, clearTextureAtlas: vi.fn() };
}

afterEach(() => {
  document.documentElement.style.removeProperty('--font-terminal');
  document.documentElement.style.removeProperty('--font-mono');
});

describe('terminalFont', () => {
  it('is the terminal font token, not the mono font the rest of the app uses', () => {
    document.documentElement.style.setProperty('--font-mono', "'Geist Mono', monospace");
    document.documentElement.style.setProperty('--font-terminal', FONT);
    expect(terminalFont()).toBe(FONT);
  });

  it('falls back to Menlo on a page without the token', () => {
    expect(terminalFont()).toBe('Menlo, monospace');
  });
});

describe('warmTerminalFont', () => {
  it('asks for the regular and the bold face before any terminal opens', () => {
    document.documentElement.style.setProperty('--font-terminal', FONT);
    const fonts = fontSet(false);
    warmTerminalFont(fonts.set);
    expect(fonts.load.mock.calls.map(([spec]) => spec)).toEqual([
      '12.5px "SF Mono"',
      'bold 12.5px "SF Mono"',
    ]);
  });
});

describe('refitWhenFontLoads', () => {
  it('measures again, drops the drawn glyphs and refits once the font has loaded', async () => {
    const opened = terminal();
    const refit = vi.fn();
    const fonts = fontSet(false);
    refitWhenFontLoads(opened, refit, fonts.set);
    expect(refit).not.toHaveBeenCalled();
    expect(fonts.load.mock.calls.map(([spec]) => spec)).toEqual([
      '12.5px "SF Mono"',
      'bold 12.5px "SF Mono"',
    ]);
    fonts.finish();
    await vi.waitFor(() => expect(refit).toHaveBeenCalledTimes(2));
    expect(opened.clearTextureAtlas).toHaveBeenCalledTimes(2);
    expect(opened.options.fontFamily.startsWith(FONT)).toBe(true);
  });

  it('asks for nothing when the font was ready before the terminal opened', () => {
    const fonts = fontSet(true);
    refitWhenFontLoads(terminal(), vi.fn(), fonts.set);
    expect(fonts.load).not.toHaveBeenCalled();
  });

  it('redraws when another face of the terminal font arrives later', () => {
    const opened = terminal();
    const refit = vi.fn();
    const fonts = fontSet(true);
    refitWhenFontLoads(opened, refit, fonts.set);
    fonts.faceLoaded('SF');
    expect(refit).not.toHaveBeenCalled();
    fonts.faceLoaded('"SF Mono"');
    expect(opened.options.fontFamily).not.toBe(FONT);
    fonts.faceLoaded('SF Mono');
    expect(opened.options.fontFamily).toBe(FONT);
    expect(opened.clearTextureAtlas).toHaveBeenCalledTimes(2);
    expect(refit).toHaveBeenCalledTimes(2);
  });

  it('ignores the app mono font finishing after the terminal opened', () => {
    const opened = terminal();
    const refit = vi.fn();
    const fonts = fontSet(true);
    refitWhenFontLoads(opened, refit, fonts.set);
    fonts.faceLoaded('Geist Mono');
    expect(refit).not.toHaveBeenCalled();
    expect(opened.clearTextureAtlas).not.toHaveBeenCalled();
    expect(opened.options.fontFamily).toBe(FONT);
  });

  it('leaves a terminal that closed before the font loaded alone', async () => {
    const opened = terminal();
    const refit = vi.fn();
    const fonts = fontSet(false);
    const unfollow = refitWhenFontLoads(opened, refit, fonts.set);
    unfollow();
    fonts.finish();
    fonts.faceLoaded('SF Mono');
    await Promise.resolve();
    await Promise.resolve();
    expect(refit).not.toHaveBeenCalled();
    expect(opened.options.fontFamily).toBe(FONT);
  });
});
