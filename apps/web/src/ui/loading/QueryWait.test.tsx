// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryWait, type WaitableQuery } from './QueryWait.tsx';
import { Skeleton } from './Skeleton.tsx';
import { SLOW_LOAD_MS } from './use-slow-load.ts';

function query(overrides: Partial<WaitableQuery>): WaitableQuery {
  return {
    data: undefined,
    isPending: true,
    isError: false,
    isFetching: true,
    error: null,
    refetch: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

function show(waitable: WaitableQuery) {
  return render(
    <QueryWait query={waitable} what="the audit">
      <Skeleton label="Gathering the audit" shape="cards" rows={2} />
    </QueryWait>,
  );
}

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('QueryWait', () => {
  it('shows the skeleton with a status label while loading', () => {
    show(query({}));
    expect(screen.getByRole('status').textContent).toBe('Gathering the audit');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('offers a retry once loading is slow', () => {
    const waitable = query({});
    show(waitable);
    act(() => vi.advanceTimersByTime(SLOW_LOAD_MS + 1));
    expect(screen.getByText('The audit is taking a while.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(waitable.refetch).toHaveBeenCalledTimes(1);
  });

  it('turns a failure into a friendly retry', () => {
    const waitable = query({
      isPending: false,
      isError: true,
      isFetching: false,
      error: new Error('The server responded with 500.'),
    });
    show(waitable);
    const alert = screen.getByRole('alert').textContent;
    expect(alert).toContain('Couldn’t load the audit.');
    expect(alert).toContain('The server responded with 500.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(waitable.refetch).toHaveBeenCalledTimes(1);
  });

  it('renders nothing once data has arrived', () => {
    const { container } = show(query({ data: {}, isPending: false, isFetching: false }));
    expect(container.childElementCount).toBe(0);
  });
});
