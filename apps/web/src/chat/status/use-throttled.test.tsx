// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useThrottled } from './use-status-line.ts';

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const settle = (ms: number) => act(() => vi.advanceTimersByTime(ms));

describe('the status read to a screen reader', () => {
  it('changes at once when the agent starts waiting, and keeps step detail to one per gap', () => {
    const { result, rerender } = renderHook(
      ({ value, state }) => useThrottled(value, 4_000, state),
      { initialProps: { value: 'Claude is working: reading a.ts', state: 'running ' } },
    );
    settle(0);
    expect(result.current).toBe('Claude is working: reading a.ts');

    rerender({ value: 'Claude is working: reading b.ts', state: 'running ' });
    settle(1_000);
    expect(result.current).toBe('Claude is working: reading a.ts');

    rerender({
      value: 'Claude is waiting on 2 sub-agents…',
      state: 'running waiting on 2 sub-agents',
    });
    settle(0);
    expect(result.current).toBe('Claude is waiting on 2 sub-agents…');
  });
});
