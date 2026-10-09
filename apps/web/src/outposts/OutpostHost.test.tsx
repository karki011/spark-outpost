// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from '../api/client.ts';
import { projectKeys } from '../api/projects.ts';
import { useOutpostSeam } from '../chat/outpost/outpost-seam.ts';
import { OutpostHost } from './OutpostHost.tsx';
import { outpostKeys } from './outposts-api.ts';
import { API_CHAT, FE_CHAT, OUTPOST_ID, chat, detail, member, outpost } from './test-fixtures.ts';

interface Call {
  method: string;
  path: string;
  body: unknown;
}

let client: QueryClient;
let calls: Call[];

function Probe() {
  const seam = useOutpostSeam();
  if (!seam) return <p>No seam</p>;
  return (
    <>
      <p>{seam.outposts.map((listed) => listed.name).join(', ')}</p>
      <p>Open: {seam.openOutpostId ?? 'none'}</p>
      <button type="button" onClick={() => seam.onNewOutpost(FE_CHAT)}>
        New from chat
      </button>
      <button
        type="button"
        onClick={() =>
          void seam.onAddToOutpost(OUTPOST_ID, { conversationId: API_CHAT, handle: 'api' })
        }
      >
        Add chat
      </button>
    </>
  );
}

function renderHost(onOpenOutpost = vi.fn()) {
  render(
    <QueryClientProvider client={client}>
      <OutpostHost openOutpostId={OUTPOST_ID} onOpenOutpost={onOpenOutpost}>
        <Probe />
      </OutpostHost>
    </QueryClientProvider>,
  );
  return onOpenOutpost;
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(queryKeys.conversations, [
    chat(FE_CHAT, { title: 'Usage page' }),
    chat(API_CHAT, { title: 'Usage endpoint' }),
  ]);
  client.setQueryData(projectKeys.all, []);
  client.setQueryData(outpostKeys.list, [outpost({ members: [member(FE_CHAT, 'fe', 1)] })]);
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'GET') return Promise.resolve(new Response('[]', { status: 200 }));
      const body: unknown = JSON.parse(String(init?.body));
      calls.push({ method, path: url, body });
      const id = method === 'POST' ? (body as { id: string }).id : OUTPOST_ID;
      return Promise.resolve(new Response(JSON.stringify(detail([], { id })), { status: 200 }));
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('OutpostHost', () => {
  it('gives the chat surfaces the outposts and the one that is open', () => {
    renderHost();
    expect(screen.getByText('Usage by user')).toBeTruthy();
    expect(screen.getByText(`Open: ${OUTPOST_ID}`)).toBeTruthy();
  });

  it('opens the create sheet with the chat it was asked from, then opens the new outpost', async () => {
    const onOpenOutpost = renderHost();
    fireEvent.click(screen.getByRole('button', { name: 'New from chat' }));
    const dialog = await screen.findByRole('dialog', { name: 'New outpost' });
    expect(dialog).toBeTruthy();
    expect(
      screen.getByRole<HTMLInputElement>('textbox', { name: 'Handle for Usage page' }).value,
    ).toBe('usage-page');
    fireEvent.change(screen.getByRole('textbox', { name: /^Name/ }), {
      target: { value: 'Orders launch' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create outpost' }));
    await waitFor(() => expect(onOpenOutpost).toHaveBeenCalledTimes(1));
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/outposts' });
    expect(onOpenOutpost).toHaveBeenCalledWith((calls[0]?.body as { id: string }).id);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('adds a chat through the shared member call', async () => {
    renderHost();
    fireEvent.click(screen.getByRole('button', { name: 'Add chat' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({
      method: 'PUT',
      path: `/api/outposts/${OUTPOST_ID}/members/${API_CHAT}`,
      body: { handle: 'api' },
    });
  });
});
