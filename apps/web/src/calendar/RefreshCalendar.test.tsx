// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { calendarApi } from './calendar-api.ts';
import { RefreshCalendar } from './RefreshCalendar.tsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function show() {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <RefreshCalendar />
    </QueryClientProvider>,
  );
  return invalidate;
}

describe('Refresh now', () => {
  it('asks Spark to re-read the calendars once, then says it is up to date', async () => {
    let finish: () => void = () => undefined;
    const refresh = vi.spyOn(calendarApi, 'refresh').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ refreshedAt: new Date().toISOString() });
        }),
    );
    const invalidate = show();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh now' }));
    const busy = await screen.findByRole('button', { name: 'Refreshing…' });
    fireEvent.click(busy);
    expect(refresh).toHaveBeenCalledTimes(1);
    finish();
    expect(await screen.findByText('Updated just now')).toBeTruthy();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['calendar'] });
  });

  it('says so when the refresh fails', async () => {
    vi.spyOn(calendarApi, 'refresh').mockRejectedValue(new Error('offline'));
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh now' }));
    expect(await screen.findByText("Couldn't refresh")).toBeTruthy();
  });
});
