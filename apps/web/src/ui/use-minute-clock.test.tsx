// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { msToNextMinute, useMinuteClock } from './use-minute-clock.ts';

function Shown() {
  return <output>{new Date(useMinuteClock()).getMinutes()}</output>;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 17, 16, 30, 45));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useMinuteClock', () => {
  it('waits for the rest of the minute', () => {
    expect(msToNextMinute(new Date(2026, 9, 17, 16, 30, 45).getTime())).toBe(15_000);
    expect(msToNextMinute(new Date(2026, 9, 17, 16, 30, 0).getTime())).toBe(60_000);
  });

  it('ticks on each minute boundary', () => {
    render(<Shown />);
    expect(screen.getByRole('status').textContent).toBe('30');
    act(() => vi.advanceTimersByTime(14_999));
    expect(screen.getByRole('status').textContent).toBe('30');
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('status').textContent).toBe('31');
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByRole('status').textContent).toBe('32');
  });
});
