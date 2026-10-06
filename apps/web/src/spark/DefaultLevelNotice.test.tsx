// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DefaultLevelNotice } from './DefaultLevelNotice.tsx';

const SETTLE = { timeout: 3000 };
const NOTICE =
  /New chats now use Full auto → PR: Spark opens a pull request when the work is done\./;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setupState(defaultLevelNotice: boolean) {
  return {
    profile: {
      displayName: 'Ada',
      defaultProvider: null,
      onboardingCompleted: true,
      defaultLevelNotice,
    },
    providers: [],
    advisors: [],
  };
}

class NoResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function server(pending: boolean) {
  const state = { pending, updates: [] as unknown[] };
  vi.stubGlobal('ResizeObserver', NoResizeObserver);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        state.updates.push(JSON.parse(String(init.body)));
        state.pending = false;
      }
      return new Response(JSON.stringify(setupState(state.pending)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
  return state;
}

function show(onSettings = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = () => (
    <QueryClientProvider client={client}>
      <DefaultLevelNotice onSettings={onSettings} />
    </QueryClientProvider>
  );
  render(view());
  return { onSettings, client };
}

describe('the one-time notice about the new default', () => {
  it('stays hidden on an install that never had the old default', async () => {
    server(false);
    const { client } = show();
    await waitFor(() => expect(client.isFetching()).toBe(0), SETTLE);
    expect(screen.queryByText(NOTICE)).toBeNull();
  });

  it('shows once on an existing install and stays gone after it is dismissed', async () => {
    const state = server(true);
    const { client } = show();
    expect(await screen.findByText(NOTICE, undefined, SETTLE)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    await waitFor(() => expect(screen.queryByText(NOTICE)).toBeNull(), SETTLE);
    expect(state.updates).toEqual([{ defaultLevelNotice: false }]);
    await client.invalidateQueries();
    await waitFor(() => expect(client.isFetching()).toBe(0), SETTLE);
    expect(screen.queryByText(NOTICE)).toBeNull();
  });

  it('opens Settings from its link and counts that as seen', async () => {
    const state = server(true);
    const { onSettings } = show();
    const link = await screen.findByRole(
      'button',
      { name: 'Change the default in Settings' },
      SETTLE,
    );

    fireEvent.click(link);

    expect(onSettings).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(state.updates).toEqual([{ defaultLevelNotice: false }]), SETTLE);
    await waitFor(() => expect(screen.queryByText(NOTICE)).toBeNull(), SETTLE);
  });
});
