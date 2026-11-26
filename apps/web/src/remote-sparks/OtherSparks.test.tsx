// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RemoteSpark, RemoteSparkList } from '@spark-outpost/contracts';
import { requestAddSpark } from './add-spark-request.ts';
import { OtherSparks } from './OtherSparks.tsx';
import {
  OTHER_SPARKS_EMPTY,
  OTHER_SPARKS_INTRO,
  OTHER_SPARKS_UNAVAILABLE,
  lastOpenedLine,
} from './remote-sparks-copy.ts';

const LOCAL = { name: null, defaultName: 'Hazel’s MacBook', icon: null };
const SETTLE = { timeout: 3000 };
const CELLAR_ID = '33333333-3333-4333-8333-333333333333';
const LOFT_ID = '44444444-4444-4444-8444-444444444444';
const STUDIO: RemoteSpark = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Studio Mac',
  hostname: 'studio.tail1234.ts.net',
  reach: 'tailscale',
  paired: true,
  status: 'online',
  needsYou: 2,
  icon: null,
  createdAt: '2026-11-20T10:00:00Z',
  lastOpenedAt: '2026-11-24T10:00:00Z',
};
const ATTIC: RemoteSpark = {
  ...STUDIO,
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Attic Mac',
  hostname: 'attic.tail1234.ts.net',
  paired: false,
  status: 'not-paired',
  needsYou: 0,
  lastOpenedAt: null,
};

interface Call {
  method: string;
  path: string;
  body: unknown;
}

function serve(list: RemoteSparkList): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method !== 'GET') {
        calls.push({
          method,
          path: String(url),
          body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
        });
      }
      return new Response(JSON.stringify(method === 'GET' ? list : {}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
  return calls;
}

async function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <OtherSparks ownHostname="mine.tail1234.ts.net" />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(client.isFetching()).toBe(0), SETTLE);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('OtherSparks', () => {
  it('says what the card is for and offers to add the first Spark', async () => {
    serve({ available: true, local: LOCAL, sparks: [] });
    await show();
    expect(screen.getByText(OTHER_SPARKS_INTRO)).toBeTruthy();
    expect(screen.getByText(OTHER_SPARKS_EMPTY)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add a Spark' })).toBeTruthy();
  });

  it('shows one line and no Add button outside the Mac app', async () => {
    serve({ available: false, local: LOCAL, sparks: [STUDIO] });
    await show();
    expect(screen.getByText(OTHER_SPARKS_UNAVAILABLE)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add a Spark' })).toBeNull();
    expect(screen.queryByText('Studio Mac')).toBeNull();
  });

  it('shows each status as a word and how many requests wait', async () => {
    const cellar: RemoteSpark = { ...STUDIO, id: CELLAR_ID, name: 'Cellar Mac', status: 'offline' };
    const loft: RemoteSpark = { ...cellar, id: LOFT_ID, name: 'Loft Mac', status: 'checking' };
    serve({
      available: true,
      local: LOCAL,
      sparks: [STUDIO, ATTIC, { ...cellar, needsYou: 0 }, loft],
    });
    await show();
    const rows = screen.getAllByRole('listitem').slice(1);
    const words = ['Online', 'Not paired yet', 'Offline', 'Checking'];
    rows.forEach((row, index) => {
      const status = within(row).getByText(words[index]!);
      expect(status.getAttribute('data-status')).toBe(
        ['online', 'not-paired', 'offline', 'checking'][index],
      );
      expect(status.querySelector('svg, .spin')).toBeTruthy();
    });
    expect(within(rows[0]!).getByText('2 waiting')).toBeTruthy();
    expect(within(rows[1]!).queryByText(/waiting$/)).toBeNull();
    expect(within(rows[2]!).queryByText(/waiting$/)).toBeNull();
    expect(within(rows[3]!).getByText('2 waiting')).toBeTruthy();
  });

  it('opens the Add dialog when it was asked for from elsewhere', async () => {
    serve({ available: true, local: LOCAL, sparks: [STUDIO] });
    requestAddSpark();
    await show();
    expect(screen.getByRole('dialog', { name: 'Add a Spark' })).toBeTruthy();
  });

  it('shows a paired and a waiting Spark with their state in words', async () => {
    serve({ available: true, local: LOCAL, sparks: [STUDIO, ATTIC] });
    await show();
    const [, studio, attic] = screen.getAllByRole('listitem');
    expect(within(studio!).getByText('Online')).toBeTruthy();
    expect(within(studio!).getByText(/studio\.tail1234\.ts\.net · Last opened /)).toBeTruthy();
    expect(within(attic!).getByText('Not paired yet')).toBeTruthy();
    expect(within(attic!).getByText(/Last opened: Never/)).toBeTruthy();
    expect(within(attic!).getByRole('button', { name: 'Open Attic Mac' })).toBeTruthy();
    fireEvent.click(within(attic!).getByRole('button', { name: 'Actions for Attic Mac' }));
    const menu = screen.getByRole('menu', { name: 'Actions for Attic Mac' });
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Rename', 'Change icon…', 'Remove…']);
  });

  it('opens a saved Spark', async () => {
    const calls = serve({ available: true, local: LOCAL, sparks: [STUDIO] });
    await show();
    fireEvent.click(screen.getByRole('button', { name: 'Open Studio Mac' }));
    await waitFor(() => expect(calls).toHaveLength(1), SETTLE);
    expect(calls[0]).toMatchObject({
      method: 'POST',
      path: `/api/remote-sparks/${STUDIO.id}/open`,
    });
  });

  it('renames a saved Spark', async () => {
    const calls = serve({ available: true, local: LOCAL, sparks: [STUDIO] });
    await show();
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Studio Mac' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    fireEvent.change(screen.getByLabelText('New name for Studio Mac'), {
      target: { value: ' Garage Mac ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls).toHaveLength(1), SETTLE);
    expect(calls[0]).toMatchObject({ method: 'PATCH', body: { name: 'Garage Mac' } });
  });

  it('asks before removing and says the host must revoke', async () => {
    const calls = serve({ available: true, local: LOCAL, sparks: [STUDIO] });
    await show();
    const actions = screen.getByRole('button', { name: 'Actions for Studio Mac' });
    const chooseRemove = () => {
      fireEvent.click(actions);
      fireEvent.click(screen.getByRole('menuitem', { name: 'Remove…' }));
    };
    chooseRemove();
    const dialog = screen.getByRole('alertdialog', { name: 'Remove Studio Mac?' });
    expect(within(dialog).getByText(/Also revoke this Mac on Studio Mac/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(document.activeElement).toBe(actions);
    expect(calls).toHaveLength(0);

    chooseRemove();
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove' }),
    );
    await waitFor(() => expect(calls).toHaveLength(1), SETTLE);
    expect(calls[0]).toMatchObject({ method: 'DELETE', path: `/api/remote-sparks/${STUDIO.id}` });
  });
});

describe('lastOpenedLine', () => {
  it('names the time, or says never', () => {
    const now = new Date('2026-11-24T13:00:00Z').getTime();
    expect(lastOpenedLine(STUDIO, now)).toBe('Last opened 3 h ago');
    expect(lastOpenedLine(ATTIC, now)).toBe('Last opened: Never');
  });
});
