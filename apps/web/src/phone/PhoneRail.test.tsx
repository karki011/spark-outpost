// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { REMOTE_SWITCH_DEFAULTS, type RemoteSparkList } from '@spark-outpost/contracts';
import { PhoneRail } from './PhoneRail.tsx';

const SETTLE = { timeout: 3000 };
const SPARK: RemoteSparkList['sparks'][number] = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Studio Mac',
  hostname: 'studio.tail1234.ts.net',
  reach: 'tailscale',
  paired: true,
  status: 'online',
  needsYou: 0,
  createdAt: '2026-11-20T10:00:00Z',
  lastOpenedAt: null,
};

async function show(list: RemoteSparkList) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify(list), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    ),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PhoneRail
        state={{ status: 'off', hostname: null, address: null, message: null }}
        wanted={false}
        devices={[]}
        switches={{ ...REMOTE_SWITCH_DEFAULTS }}
        lastRequest={null}
        turning={false}
        failure={null}
        onTurn={() => undefined}
      />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(client.isFetching()).toBe(0), SETTLE);
  return within(screen.getByRole('heading', { name: 'At a glance' }).parentElement!);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('At a glance', () => {
  it('counts the saved Sparks', async () => {
    const glance = await show({
      available: true,
      sparks: [SPARK, { ...SPARK, id: '22222222-2222-4222-8222-222222222222' }],
    });
    const term = glance.getByText('Other Sparks');
    expect(term.tagName).toBe('DT');
    expect(term.nextElementSibling?.textContent).toBe('2');
  });

  it('has no Other Sparks row with none saved or outside the Mac app', async () => {
    const empty = await show({ available: true, sparks: [] });
    expect(empty.getByText('Paired')).toBeTruthy();
    expect(empty.queryByText('Other Sparks')).toBeNull();
    cleanup();
    const elsewhere = await show({ available: false, sparks: [SPARK] });
    expect(elsewhere.queryByText('Other Sparks')).toBeNull();
  });
});
