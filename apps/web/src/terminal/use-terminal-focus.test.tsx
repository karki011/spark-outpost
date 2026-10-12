// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SidebarLayout } from '../conversations/sidebar-layout.tsx';

const fake = vi.hoisted(() => ({ sidebar: null as SidebarLayout | null }));
vi.mock('../conversations/sidebar-layout.tsx', () => ({ useSidebarLayout: () => fake.sidebar }));
const { isFocusShortcut, useTerminalFocus } = await import('./use-terminal-focus.ts');

const setImmersive = vi.fn();

function sidebar(collapsed: boolean): SidebarLayout {
  const layout = {
    collapsed,
    narrow: false,
    setImmersive,
    toggle: vi.fn(() => {
      fake.sidebar = { ...layout, collapsed: !layout.collapsed } as unknown as SidebarLayout;
    }),
    reveal: vi.fn(() => {
      fake.sidebar = { ...layout, collapsed: false } as unknown as SidebarLayout;
    }),
  };
  return layout as unknown as SidebarLayout;
}

function panel(open: boolean) {
  const state = { open, setOpen: vi.fn((next: boolean) => void (state.open = next)) };
  return state;
}

function press(init: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true });
  act(() => void window.dispatchEvent(event));
  return event;
}

beforeEach(() => {
  localStorage.clear();
  setImmersive.mockClear();
  fake.sidebar = sidebar(false);
});
afterEach(cleanup);

describe('terminal focus', () => {
  it('hides the sidebar and the Work panel, and puts back what it hid on exit', () => {
    const first = fake.sidebar!;
    const work = panel(true);
    const hook = renderHook(() => useTerminalFocus('chat', work, true));
    expect(hook.result.current.focused).toBe(false);
    act(() => hook.result.current.toggle());
    expect(hook.result.current.focused).toBe(true);
    expect(first.toggle).toHaveBeenCalledTimes(1);
    expect(work.setOpen).toHaveBeenLastCalledWith(false);
    hook.rerender();
    act(() => hook.result.current.toggle());
    expect(hook.result.current.focused).toBe(false);
    expect(first.reveal).toHaveBeenCalledTimes(1);
    expect(work.setOpen).toHaveBeenLastCalledWith(true);
  });

  it('hides the icon rail while focused and brings it back on exit', () => {
    const hook = renderHook(() => useTerminalFocus('chat', null, true));
    expect(setImmersive).not.toHaveBeenCalled();
    act(() => hook.result.current.toggle());
    expect(setImmersive).toHaveBeenLastCalledWith(true);
    act(() => hook.result.current.toggle());
    expect(setImmersive).toHaveBeenLastCalledWith(false);
  });

  it('brings the icon rail back when a focused chat closes', () => {
    const hook = renderHook(() => useTerminalFocus('chat', null, true));
    act(() => hook.result.current.toggle());
    hook.unmount();
    expect(setImmersive).toHaveBeenLastCalledWith(false);
  });

  it('leaves a sidebar and panel the user had already closed as they were', () => {
    fake.sidebar = sidebar(true);
    const first = fake.sidebar;
    const work = panel(false);
    const hook = renderHook(() => useTerminalFocus('chat', work, true));
    act(() => hook.result.current.toggle());
    act(() => hook.result.current.toggle());
    expect(first.toggle).not.toHaveBeenCalled();
    expect(first.reveal).not.toHaveBeenCalled();
    expect(work.setOpen).not.toHaveBeenCalled();
  });

  it('remembers the choice for that chat only, and restores the layout when the chat closes', () => {
    const first = fake.sidebar!;
    const hook = renderHook(() => useTerminalFocus('chat', null, true));
    act(() => hook.result.current.toggle());
    hook.unmount();
    expect(first.reveal).toHaveBeenCalledTimes(1);
    fake.sidebar = sidebar(false);
    expect(renderHook(() => useTerminalFocus('other', null, true)).result.current.focused).toBe(
      false,
    );
    expect(renderHook(() => useTerminalFocus('chat', null, true)).result.current.focused).toBe(
      true,
    );
  });

  it('puts back what it hid before the app was closed in focus', () => {
    localStorage.setItem('spark-outpost.terminal.focus', '{"chat":{"sidebar":true,"panel":true}}');
    fake.sidebar = sidebar(true);
    const reopened = fake.sidebar;
    const closed = panel(false);
    const hook = renderHook(() => useTerminalFocus('chat', closed, true));
    expect(hook.result.current.focused).toBe(true);
    act(() => hook.result.current.toggle());
    expect(reopened.reveal).toHaveBeenCalledTimes(1);
    expect(closed.setOpen).toHaveBeenLastCalledWith(true);
    expect(localStorage.getItem('spark-outpost.terminal.focus')).toBe('{}');
  });

  it('toggles with the shortcut and never with Escape', () => {
    const hook = renderHook(() => useTerminalFocus('chat', null, true));
    expect(press({ key: 'Escape', code: 'Escape' }).defaultPrevented).toBe(false);
    expect(hook.result.current.focused).toBe(false);
    const chord = { code: 'KeyF', shiftKey: true, metaKey: true, ctrlKey: false, altKey: false };
    const other = { ...chord, metaKey: false, ctrlKey: true };
    expect(isFocusShortcut(chord, true)).toBe(true);
    expect(isFocusShortcut(other, true)).toBe(false);
    expect(isFocusShortcut(other, false)).toBe(true);
    expect(isFocusShortcut({ ...chord, shiftKey: false }, true)).toBe(false);
    const pressed = press(isFocusShortcut(chord) ? chord : other);
    expect(pressed.defaultPrevented).toBe(true);
    expect(hook.result.current.focused).toBe(true);
  });

  it('does nothing on a paired phone', () => {
    const first = fake.sidebar!;
    localStorage.setItem(
      'spark-outpost.terminal.focus',
      '{"chat":{"sidebar":false,"panel":false}}',
    );
    const hook = renderHook(() => useTerminalFocus('chat', null, false));
    expect(hook.result.current.focused).toBe(false);
    expect(first.toggle).not.toHaveBeenCalled();
  });
});
