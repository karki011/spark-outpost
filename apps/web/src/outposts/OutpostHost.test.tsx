// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from '../api/client.ts';
import { projectKeys } from '../api/projects.ts';
import { useOutpostSeam } from '../chat/outpost/outpost-seam.ts';
import { STORY_DRAFT_ID, seedCreateQueries } from './create/create-fixtures.ts';
import { OutpostHost } from './OutpostHost.tsx';
import { outpostKeys } from './outposts-api.ts';
import { API_CHAT, FE_CHAT, OUTPOST_ID, chat, detail, member, outpost } from './test-fixtures.ts';

interface Call {
  method: string;
  path: string;
  body: unknown;
}

const LAZY_SHEET_TIMEOUT = 10_000;
const LAZY_TEST_TIMEOUT = 20_000;

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
      <button type="button" onClick={() => seam.onOpenDraft?.(STORY_DRAFT_ID)}>
        Review draft
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
  seedCreateQueries(client);
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

  it(
    'opens the create sheet with the chat it was asked from, then opens the new outpost',
    async () => {
      const onOpenOutpost = renderHost();
      fireEvent.click(screen.getByRole('button', { name: 'New from chat' }));
      const dialog = await screen.findByRole(
        'dialog',
        { name: 'New outpost' },
        { timeout: LAZY_SHEET_TIMEOUT },
      );
      expect(dialog).toBeTruthy();
      const name = screen.getByRole('textbox', { name: /^Name/ });
      fireEvent.change(name, { target: { value: 'Orders launch' } });
      fireEvent.keyDown(name, { key: 'Enter' });
      expect(
        screen.getByRole<HTMLInputElement>('textbox', { name: 'Handle for Usage page' }).value,
      ).toBe('usage-page');
      fireEvent.click(screen.getByRole('button', { name: /^Continue/ }));
      fireEvent.click(screen.getByRole('button', { name: /^Start outpost/ }));
      await waitFor(() => expect(onOpenOutpost).toHaveBeenCalledTimes(1));
      expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/outposts' });
      expect(onOpenOutpost).toHaveBeenCalledWith((calls[0]?.body as { id: string }).id);
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    },
    LAZY_TEST_TIMEOUT,
  );

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

  it(
    'opens the outpost of a draft a chat proposed that was already started',
    async () => {
      client.setQueryData(outpostKeys.draft(STORY_DRAFT_ID), {
        id: STORY_DRAFT_ID,
        conversationId: FE_CHAT,
        outpostId: OUTPOST_ID,
        body: { title: 'Checkout', chats: [] },
        startedAt: '2026-10-09T10:00:00.000Z',
      });
      const onOpenOutpost = renderHost();
      fireEvent.click(screen.getByRole('button', { name: 'Review draft' }));
      await waitFor(() => expect(onOpenOutpost).toHaveBeenCalledWith(OUTPOST_ID), {
        timeout: LAZY_SHEET_TIMEOUT,
      });
    },
    LAZY_TEST_TIMEOUT,
  );

  it(
    'opens the create sheet from a draft a chat proposed',
    async () => {
      client.setQueryData(outpostKeys.draft(STORY_DRAFT_ID), {
        id: STORY_DRAFT_ID,
        conversationId: API_CHAT,
        outpostId: null,
        body: { name: 'Orders launch', title: 'Checkout', chats: [] },
        startedAt: null,
      });
      client.setQueryData(queryKeys.conversation(API_CHAT), {
        settings: { provider: 'codex', model: null, routing: 'auto', agentMode: 'agent' },
      });
      renderHost();
      fireEvent.click(screen.getByRole('button', { name: 'Review draft' }));
      await screen.findByRole('dialog', { name: 'New outpost' }, { timeout: LAZY_SHEET_TIMEOUT });
      expect(screen.getByRole<HTMLInputElement>('textbox', { name: /^Name/ }).value).toBe(
        'Orders launch',
      );
    },
    LAZY_TEST_TIMEOUT,
  );
});
