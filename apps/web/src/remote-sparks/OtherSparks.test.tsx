// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RemoteSpark } from '@spark-outpost/contracts';
import { OtherSparks } from './OtherSparks.tsx';
import {
  OTHER_SPARKS_EMPTY,
  OTHER_SPARKS_INTRO,
  OTHER_SPARKS_UNAVAILABLE,
  lastOpenedLine,
} from './remote-sparks-copy.ts';

const SETTLE = { timeout: 3000 };
const STUDIO: RemoteSpark = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Studio Mac',
  hostname: 'studio.tail1234.ts.net',
  reach: 'tailscale',
  paired: true,
  createdAt: '2026-11-20T10:00:00Z',
  lastOpenedAt: '2026-11-24T10:00:00Z',
};
const ATTIC: RemoteSpark = {
  ...STUDIO,
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Attic Mac',
  hostname: 'attic.tail1234.ts.net',
  paired: false,
  lastOpenedAt: null,
};

interface Call {
  method: string;
  path: string;
  body: unknown;
}

function serve(list: { available: boolean; sparks: RemoteSpark[] }): Call[] {
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
    serve({ available: true, sparks: [] });
    await show();
    expect(screen.getByText(OTHER_SPARKS_INTRO)).toBeTruthy();
    expect(screen.getByText(OTHER_SPARKS_EMPTY)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add a Spark' })).toBeTruthy();
  });

  it('shows one line and no Add button outside the Mac app', async () => {
    serve({ available: false, sparks: [STUDIO] });
    await show();
    expect(screen.getByText(OTHER_SPARKS_UNAVAILABLE)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add a Spark' })).toBeNull();
    expect(screen.queryByText('Studio Mac')).toBeNull();
  });

  it('shows a paired and a waiting Spark with their state in words', async () => {
    serve({ available: true, sparks: [STUDIO, ATTIC] });
    await show();
    const [studio, attic] = screen.getAllByRole('listitem');
    expect(within(studio!).getByText('Paired')).toBeTruthy();
    expect(within(studio!).getByText(/studio\.tail1234\.ts\.net · Last opened /)).toBeTruthy();
    expect(within(attic!).getByText('Not paired yet')).toBeTruthy();
    expect(within(attic!).getByText(/Last opened: Never/)).toBeTruthy();
    for (const action of ['Open', 'Rename', 'Remove']) {
      expect(within(attic!).getByRole('button', { name: `${action} Attic Mac` })).toBeTruthy();
    }
  });

  it('opens a saved Spark', async () => {
    const calls = serve({ available: true, sparks: [STUDIO] });
    await show();
    fireEvent.click(screen.getByRole('button', { name: 'Open Studio Mac' }));
    await waitFor(() => expect(calls).toHaveLength(1), SETTLE);
    expect(calls[0]).toMatchObject({
      method: 'POST',
      path: `/api/remote-sparks/${STUDIO.id}/open`,
    });
  });

  it('renames a saved Spark', async () => {
    const calls = serve({ available: true, sparks: [STUDIO] });
    await show();
    fireEvent.click(screen.getByRole('button', { name: 'Rename Studio Mac' }));
    fireEvent.change(screen.getByLabelText('New name for Studio Mac'), {
      target: { value: ' Garage Mac ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls).toHaveLength(1), SETTLE);
    expect(calls[0]).toMatchObject({ method: 'PATCH', body: { name: 'Garage Mac' } });
  });

  it('asks before removing and says the host must revoke', async () => {
    const calls = serve({ available: true, sparks: [STUDIO] });
    await show();
    const remove = screen.getByRole('button', { name: 'Remove Studio Mac' });
    fireEvent.click(remove);
    const dialog = screen.getByRole('alertdialog', { name: 'Remove Studio Mac?' });
    expect(within(dialog).getByText(/Also revoke this Mac on Studio Mac/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(document.activeElement).toBe(remove);
    expect(calls).toHaveLength(0);

    fireEvent.click(remove);
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
