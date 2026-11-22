// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QuietNote } from './QuietNote.tsx';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('QuietNote', () => {
  it('stays hidden for the first minute of silence, then counts the minutes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-11-22T10:00:30.000Z'));
    const since = Date.parse('2026-11-22T10:00:00.000Z');
    render(<QuietNote since={since} className="quiet" prefix=" · " />);
    expect(screen.queryByText(/No output/)).toBeNull();
    act(() => vi.advanceTimersByTime(31_000));
    expect(screen.getByText(/No output for 1m/)).toBeTruthy();
    act(() => vi.advanceTimersByTime(120_000));
    expect(screen.getByText(/No output for 3m/)).toBeTruthy();
  });

  it('shows nothing without a time to count from', () => {
    const { container } = render(<QuietNote since={undefined} className="quiet" />);
    expect(container.textContent).toBe('');
  });
});
