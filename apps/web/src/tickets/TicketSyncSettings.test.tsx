// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TicketConnection, TicketMoveOptions } from '@spark-outpost/contracts';
import { TicketSyncSettings } from './TicketSyncSettings.tsx';
import { ticketsApi } from './tickets-api.ts';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const jira: TicketConnection = {
  source: 'jira',
  account: 'alex@example.test',
  siteUrl: 'https://acme.atlassian.net',
  validatedAt: '2026-10-01T10:00:00.000Z',
  keySaved: true,
  moveOnShip: true,
  moveOnMerge: true,
  statusMap: {},
  moveStatuses: {},
};

const steady = { choices: ['In Progress', 'In Review'], to: 'In Progress', problem: null };
const PROBLEM = 'Several finished statuses: Shipped, Released. Choose one.';

function optionsWith(done: TicketMoveOptions['projects'][number]['moves']['done']) {
  return {
    projects: [
      {
        project: 'CP',
        moves: { in_progress: steady, in_review: { ...steady, to: 'In Review' }, done },
      },
    ],
  };
}

function show(connection: TicketConnection) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TicketSyncSettings connection={connection} />
    </QueryClientProvider>,
  );
}

describe('TicketSyncSettings', () => {
  it('shows the project’s statuses and what Automatic uses for each move', async () => {
    vi.spyOn(ticketsApi, 'moveOptions').mockResolvedValue(
      optionsWith({ choices: ['Done', 'Rejected'], to: 'Done', problem: null }),
    );
    show(jira);

    const notes = await screen.findByRole('list', { name: 'Done status by project' });
    await waitFor(() => expect(notes.textContent).toBe('CP Automatic uses Done.'));
    expect(screen.getByRole('list', { name: 'In review status by project' }).textContent).toBe(
      'CP Automatic uses In Review.',
    );
    expect(screen.getByRole('button', { name: 'Done status' }).textContent).toBe('Automatic');
    fireEvent.click(screen.getByRole('button', { name: 'Done status' }));
    const menu = screen.getByRole('menu', { name: 'Done status' });
    expect(
      within(menu)
        .getAllByRole('menuitemradio')
        .map((item) => item.textContent),
    ).toEqual(['Automatic', 'Done', 'Rejected']);
  });

  it('warns when Automatic cannot choose and saves the status the user picks', async () => {
    vi.spyOn(ticketsApi, 'moveOptions').mockResolvedValue(
      optionsWith({ choices: ['Shipped', 'Released'], to: null, problem: PROBLEM }),
    );
    const update = vi
      .spyOn(ticketsApi, 'updateSettings')
      .mockResolvedValue({ connections: [{ ...jira, moveStatuses: { done: 'Shipped' } }] });
    show({ ...jira, moveStatuses: { in_review: 'In Review' } });

    const notes = await screen.findByRole('list', { name: 'Done status by project' });
    await waitFor(() => expect(notes.textContent).toBe(`CP ${PROBLEM}`));
    expect(within(notes).getByRole('listitem').className).toBe('warn');

    fireEvent.click(screen.getByRole('button', { name: 'Done status' }));
    fireEvent.click(
      within(screen.getByRole('menu', { name: 'Done status' })).getByRole('menuitemradio', {
        name: 'Shipped',
      }),
    );
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update).toHaveBeenCalledWith('jira', {
      moveStatuses: { in_review: 'In Review', done: 'Shipped' },
    });
  });

  it('keeps the switches working and says when the statuses cannot be read', async () => {
    vi.spyOn(ticketsApi, 'moveOptions').mockRejectedValue(new Error('Jira said no.'));
    const update = vi
      .spyOn(ticketsApi, 'updateSettings')
      .mockResolvedValue({ connections: [jira] });
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <TicketSyncSettings connection={jira} />
      </QueryClientProvider>,
    );

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Couldn’t read the statuses from Jira: Jira said no.',
    );
    fireEvent.click(
      screen.getByRole('switch', { name: 'Move tickets to Done when the PR merges' }),
    );
    await waitFor(() => expect(update).toHaveBeenCalledWith('jira', { moveOnMerge: false }));
  });
});
