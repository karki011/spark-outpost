// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ARMING_MS, useArmed, useArmedAfterChange } from './island-parts.tsx';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));

describe('answering only what has been seen', () => {
  it('makes a card that just opened answerable only after a moment', () => {
    const hook = renderHook(({ id }) => useArmed(id), { initialProps: { id: 'one' } });
    expect(hook.result.current).toBe(false);
    wait(ARMING_MS);
    expect(hook.result.current).toBe(true);
  });

  it('holds the next card that slides in after a decision', () => {
    const hook = renderHook(({ id }) => useArmed(id), { initialProps: { id: 'one' } });
    wait(ARMING_MS);
    hook.rerender({ id: 'two' });
    expect(hook.result.current).toBe(false);
    wait(ARMING_MS - 1);
    expect(hook.result.current).toBe(false);
    wait(1);
    expect(hook.result.current).toBe(true);
  });

  it('leaves a list answerable when it opens and holds it when its cards change', () => {
    const hook = renderHook(({ ids }) => useArmedAfterChange(ids), {
      initialProps: { ids: 'one two' },
    });
    expect(hook.result.current).toBe(true);
    hook.rerender({ ids: 'two' });
    expect(hook.result.current).toBe(false);
    wait(ARMING_MS - 1);
    expect(hook.result.current).toBe(false);
    wait(1);
    expect(hook.result.current).toBe(true);
  });

  it('starts the hold again when the list changes before it ends', () => {
    const hook = renderHook(({ ids }) => useArmedAfterChange(ids), {
      initialProps: { ids: 'one two three' },
    });
    hook.rerender({ ids: 'two three' });
    wait(ARMING_MS - 100);
    hook.rerender({ ids: 'three' });
    wait(200);
    expect(hook.result.current).toBe(false);
    wait(ARMING_MS);
    expect(hook.result.current).toBe(true);
  });
});
