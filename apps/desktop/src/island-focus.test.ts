import { describe, expect, it } from 'vitest';
import { setIslandFocus, type FocusableWindow } from './island-focus.ts';

function fakeWindow(destroyed = false) {
  const calls: string[] = [];
  const window: FocusableWindow = {
    isDestroyed: () => destroyed,
    setFocusable: (focusable) => calls.push(`focusable:${focusable}`),
    focus: () => calls.push('focus'),
    blur: () => calls.push('blur'),
    webContents: { focus: () => calls.push('contents') },
  };
  return { window, calls };
}

describe('island keyboard focus', () => {
  it('makes the window focusable before focusing it and its page, so the caret shows', () => {
    const { window, calls } = fakeWindow();
    setIslandFocus(window, true);
    expect(calls).toEqual(['focusable:true', 'focus', 'contents']);
  });

  it('gives focus back and turns focus off again when the panel closes', () => {
    const { window, calls } = fakeWindow();
    setIslandFocus(window, false);
    expect(calls).toEqual(['blur', 'focusable:false']);
  });

  it('ignores a window that is already gone', () => {
    const { window, calls } = fakeWindow(true);
    setIslandFocus(window, true);
    setIslandFocus(window, false);
    expect(calls).toEqual([]);
  });
});
