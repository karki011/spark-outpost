// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { useAttentionItems } from '../attention/use-attention.ts';
import { useUpcoming } from './use-upcoming.ts';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function refuseEverything() {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: 'The calendar helper is not running.' }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    ),
  );
}

afterEach(() => vi.unstubAllGlobals());

it('stops waiting for the calendar when its status request fails', async () => {
  refuseEverything();
  const { result } = renderHook(() => useUpcoming(Date.now()), { wrapper });
  expect(result.current.pending).toBe(true);
  await waitFor(() => expect(result.current.pending).toBe(false));
  expect(result.current.available).toBe(false);
  expect(result.current.events).toEqual([]);
});

it('counts attention as loaded, with no items, when its request fails', async () => {
  refuseEverything();
  const { result } = renderHook(() => useAttentionItems(), { wrapper });
  expect(result.current.loaded).toBe(false);
  await waitFor(() => expect(result.current.loaded).toBe(true));
  expect(result.current.items).toEqual([]);
});
