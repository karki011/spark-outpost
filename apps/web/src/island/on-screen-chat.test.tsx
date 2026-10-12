// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useOnScreenChat, useShareOnScreenChat } from './on-screen-chat.ts';

const KEY = 'spark-outpost.on-screen-chat';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function fromOtherWindow(value: string | null): void {
  if (value) localStorage.setItem(KEY, value);
  else localStorage.removeItem(KEY);
  window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: value }));
}

describe('useShareOnScreenChat', () => {
  it('shares the chat on screen, follows it and clears it when the window goes', () => {
    const hook = renderHook(({ id }: { id: string | null }) => useShareOnScreenChat(id), {
      initialProps: { id: 'chat-a' as string | null },
    });
    expect(localStorage.getItem(KEY)).toBe('chat-a');
    hook.rerender({ id: 'chat-b' });
    expect(localStorage.getItem(KEY)).toBe('chat-b');
    hook.rerender({ id: null });
    expect(localStorage.getItem(KEY)).toBeNull();
    hook.rerender({ id: 'chat-a' });
    hook.unmount();
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});

describe('useOnScreenChat', () => {
  it('reads the chat another window shared and follows its changes', () => {
    localStorage.setItem(KEY, 'chat-a');
    const hook = renderHook(() => useOnScreenChat());
    expect(hook.result.current).toBe('chat-a');
    act(() => fromOtherWindow('chat-b'));
    expect(hook.result.current).toBe('chat-b');
    act(() => fromOtherWindow(null));
    expect(hook.result.current).toBeNull();
  });
});
