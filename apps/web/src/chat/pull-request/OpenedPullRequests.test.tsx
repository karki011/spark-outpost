// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PrWatch } from '@spark-outpost/contracts';
import { RUN, watch } from './watch-fixture.ts';

const api = vi.hoisted(() => ({ watches: [] as PrWatch[], followUp: false }));
vi.mock('./pr-follow-up-api.ts', () => ({
  prFollowUpApi: {},
  prWatchesKey: (conversationId: string) => ['conversation', conversationId, 'pull-requests'],
  prWatchesQuery: (conversationId: string) => ({
    queryKey: ['conversation', conversationId, 'pull-requests'],
    queryFn: async () => ({ watches: api.watches }),
  }),
}));
vi.mock('../../api/setup.ts', () => ({
  setupKey: ['setup'],
  setupApi: {
    get: async () => ({ profile: { prFollowUp: api.followUp, prFollowUpAsk: false } }),
  },
}));
vi.mock('../../phone/use-remote-client.ts', () => ({
  PHONE_SWITCH_OFF: 'Switched off on the Mac.',
  useRemoteClient: () => ({ remote: false, allows: () => true }),
}));
const { OpenedPullRequests } = await import('./OpenedPullRequests.tsx');

afterEach(cleanup);

function pull(number: number, repo: string, fields: Partial<PrWatch> = {}): PrWatch {
  return watch({
    id: `0190d7a0-0000-7000-8000-0000000001${String(number).padStart(2, '0')}`,
    number,
    repo,
    url: `https://github.com/${repo}/pull/${number}`,
    opened: { via: 'agent', by: 'claude', runId: RUN, at: `2026-10-05T10:00:0${number % 10}.000Z` },
    ...fields,
  });
}

async function mount(watches: PrWatch[], followUp = true) {
  api.watches = watches;
  api.followUp = followUp;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <OpenedPullRequests conversationId={watch().conversationId} runIds={[RUN]} />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(view.container.querySelector('.pr-opened')).not.toBeNull());
  return view.container;
}

describe('OpenedPullRequests', () => {
  it('keeps the single line for one pull request', async () => {
    const container = await mount([pull(7, 'acme/widgets')]);
    expect(container.querySelector('.pr-opened')?.textContent).toBe(
      'Opened pull request#7acme/widgets',
    );
    expect(screen.getByRole('link', { name: '#7' }).getAttribute('href')).toBe(
      'https://github.com/acme/widgets/pull/7',
    );
  });

  it('folds several pull requests of one repository into one line naming it once', async () => {
    const container = await mount([
      pull(2, 'acme/widgets'),
      pull(3, 'acme/widgets'),
      pull(4, 'acme/widgets'),
    ]);
    expect(container.querySelectorAll('.pr-opened')).toHaveLength(1);
    expect(container.querySelector('.pr-opened')?.textContent).toBe(
      'Opened 3 pull requests#2#3#4acme/widgets',
    );
    expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      'https://github.com/acme/widgets/pull/2',
      'https://github.com/acme/widgets/pull/3',
      'https://github.com/acme/widgets/pull/4',
    ]);
  });

  it('names the repository on each link when the repositories differ', async () => {
    const container = await mount([pull(2, 'acme/widgets'), pull(3, 'acme/gadgets')]);
    expect(container.querySelector('.pr-opened')?.textContent).toBe('Opened 2 pull requests#2#3');
    expect(screen.getByRole('link', { name: '#3 in acme/gadgets' }).getAttribute('title')).toBe(
      'acme/gadgets #3',
    );
  });

  it('offers follow-up once for all of them and keeps each ticket line', async () => {
    const failed = {
      key: 'SPK-9',
      outcome: 'failed',
      message: 'No review status.',
    } as PrWatch['ticketSync'][number];
    const container = await mount(
      [pull(2, 'acme/widgets'), pull(3, 'acme/widgets', { ticketSync: [failed] })],
      false,
    );
    await waitFor(() => expect(container.querySelectorAll('.pr-offer')).toHaveLength(1));
    expect(screen.getByRole('group', { name: 'Follow up on this PR? #2 #3' })).toBeTruthy();
    expect(container.querySelectorAll('.pr-ticket-line')).toHaveLength(1);
    expect(container.querySelector('.pr-ticket-line')?.textContent).toBe(
      'SPK-9 was not moved to review: No review status.',
    );
  });
});
