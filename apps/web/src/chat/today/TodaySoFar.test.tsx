// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TodaySummary } from '@spark-outpost/contracts';
import { TodaySoFar } from './TodaySoFar.tsx';

const SETTLE = { timeout: 3000 };
const VOICE = { personality: 'friendly' as const, name: 'Sam' };

const BUSY: TodaySummary = {
  since: '2026-09-30T00:00:00.000Z',
  chats: 2,
  waiting: 1,
  kept: 2,
  prs: 1,
  tickets: 0,
  costUsd: 0.42,
  costSource: 'reported',
  recent: [
    {
      id: '00000000-0000-4000-8000-000000000001',
      title: 'Fix the login bug',
      project: 'app',
      state: 'waiting',
      kept: 2,
      prs: 1,
      tickets: 0,
      updatedAt: '2026-09-30T10:00:00.000Z',
    },
    {
      id: '00000000-0000-4000-8000-000000000002',
      title: 'Update the docs',
      project: null,
      state: 'finished',
      kept: 0,
      prs: 0,
      tickets: 0,
      updatedAt: '2026-09-30T09:00:00.000Z',
    },
  ],
};

const QUIET: TodaySummary = {
  ...BUSY,
  chats: 0,
  waiting: 0,
  kept: 0,
  prs: 0,
  costUsd: null,
  costSource: null,
  recent: [],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function serve(body: unknown, status = 200) {
  let answer: (response: Response) => void = () => undefined;
  const pending = new Promise<Response>((resolve) => {
    answer = resolve;
  });
  const fetch = vi.fn(() => pending);
  vi.stubGlobal('fetch', fetch);
  return {
    fetch,
    reply: () =>
      answer(
        new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
  };
}

function show(onOpenChat = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TodaySoFar voice={VOICE} onOpenChat={onOpenChat} />
    </QueryClientProvider>,
  );
  return onOpenChat;
}

const region = () => screen.getByRole('region', { name: 'Today so far' });

describe('Today so far', () => {
  it('shows a content-shaped skeleton, then the numbers and chats from today', async () => {
    const server = serve(BUSY);
    const onOpenChat = show();
    expect(region().getAttribute('aria-busy')).toBe('true');
    expect(region().querySelectorAll('.today-shim').length).toBeGreaterThan(0);
    expect(server.fetch.mock.calls[0]?.[0]).toMatch(/\/home\/today\?tz=/);

    server.reply();
    const stats = await screen.findByRole('list', { name: 'Today in numbers' }, SETTLE);
    expect(
      within(stats)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['2 chats', '1 need you', '2 changes kept', '1 PR', '$0.42 spent']);
    const chats = screen.getByRole('list', { name: 'Chats from today' });
    const first = within(chats).getByRole('button', { name: /Fix the login bug/ });
    expect(first.textContent).toContain('Needs you · 2 kept · 1 PR');
    fireEvent.click(first);
    expect(onOpenChat).toHaveBeenCalledWith(BUSY.recent[0]!.id);
    expect(region().getAttribute('aria-busy')).toBe('false');
  });

  it('says something friendly on a quiet day instead of an empty list', async () => {
    serve(QUIET).reply();
    show();
    expect(
      await screen.findByText('Nothing else on the go today. A fresh start.', {}, SETTLE),
    ).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Chats from today' })).toBeNull();
  });

  it('stays out of the way when the summary cannot load', async () => {
    serve({ error: 'Nope' }, 500).reply();
    show();
    await vi.waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Today so far' })).toBeNull();
    }, SETTLE);
  });
});
