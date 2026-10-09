// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OutpostDetail } from '@spark-outpost/contracts';
import { mergeInvalidations } from '../app/live/app-event-keys.ts';
import { outpostKeys } from './outposts-api.ts';
import { API_CHAT, FE_CHAT, OUTPOST_ID, detail, outpost, post, postId } from './test-fixtures.ts';
import {
  optimisticPost,
  useAddMember,
  useAnswer,
  useCancel,
  useOutpost,
  useOutposts,
  usePause,
  usePost,
  useSaveOutpost,
} from './use-outposts.ts';

interface Call {
  method: string;
  path: string;
  body: unknown;
}

interface Pending {
  resolve: (response: Response) => void;
}

let client: QueryClient;
let calls: Call[];
let held: Pending[];
let answers: Map<string, () => Response>;

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status });
}

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function cached(): OutpostDetail | undefined {
  return client.getQueryData<OutpostDetail>(outpostKeys.detail(OUTPOST_ID));
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  calls = [];
  held = [];
  answers = new Map();
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({
        method,
        path: url,
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
      });
      const answer = answers.get(`${method} ${url}`);
      if (answer) return Promise.resolve(answer());
      return new Promise<Response>((resolve) => held.push({ resolve }));
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('reading outposts', () => {
  it('keeps the list and each outpost under one root key', async () => {
    answers.set('GET /api/outposts', () => json([outpost()]));
    answers.set(`GET /api/outposts/${OUTPOST_ID}`, () => json(detail([post(1)])));
    const list = renderHook(() => useOutposts(), { wrapper });
    const one = renderHook(() => useOutpost(OUTPOST_ID), { wrapper });
    await waitFor(() => expect(list.result.current.data).toHaveLength(1));
    await waitFor(() => expect(one.result.current.data?.posts).toHaveLength(1));
    expect(client.getQueryData(['outposts', 'list'])).toEqual([outpost()]);
    expect(client.getQueryData(['outposts', 'detail', OUTPOST_ID])).toEqual(detail([post(1)]));
  });

  it('is refreshed by an outpost_changed event', async () => {
    client.setQueryData(outpostKeys.list, [outpost()]);
    client.setQueryData(outpostKeys.detail(OUTPOST_ID), detail());
    const events = [
      {
        kind: 'outpost_changed' as const,
        conversationId: null,
        runId: null,
        outpostId: OUTPOST_ID,
      },
    ];
    for (const invalidation of mergeInvalidations(events)) {
      await client.invalidateQueries(invalidation);
    }
    expect(client.getQueryState(outpostKeys.list)?.isInvalidated).toBe(true);
    expect(client.getQueryState(outpostKeys.detail(OUTPOST_ID))?.isInvalidated).toBe(true);
  });
});

describe('optimisticPost', () => {
  it('draws a request to a member as Sent before the server has it', () => {
    const drawn = optimisticPost(detail(), { id: postId(7), text: '@api add the filter' }, 'now');
    expect(drawn).toMatchObject({
      id: postId(7),
      kind: 'request',
      body: 'add the filter',
      fromUser: true,
      toHandle: 'api',
      toConversationId: API_CHAT,
      state: 'sent',
      reason: 'Not sent yet',
      createdAt: 'now',
    });
  });

  it('draws anything else as a note with no state', () => {
    const drawn = optimisticPost(detail(), { id: postId(7), text: '@nobody hello' }, 'now');
    expect(drawn).toMatchObject({
      kind: 'note',
      body: '@nobody hello',
      toHandle: null,
      state: null,
    });
  });

  it('says Paused for a request posted to a paused outpost', () => {
    const paused = detail([], { pausedAt: '2026-10-09T10:30:00.000Z' });
    expect(optimisticPost(paused, { id: postId(7), text: '@fe go' }, 'now').reason).toBe('Paused');
  });
});

describe('usePost', () => {
  it('shows the post at once, sends it with its id, then refreshes', async () => {
    client.setQueryData(outpostKeys.detail(OUTPOST_ID), detail([post(1)]));
    const { result } = renderHook(() => usePost(OUTPOST_ID), { wrapper });
    act(() => result.current.mutate({ id: postId(2), text: '@fe build the page' }));
    await waitFor(() => expect(cached()?.posts.map((entry) => entry.id)).toContain(postId(2)));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({
      method: 'POST',
      path: `/api/outposts/${OUTPOST_ID}/posts`,
      body: { id: postId(2), text: '@fe build the page' },
    });
    answers.set(`GET /api/outposts/${OUTPOST_ID}`, () => json(detail([post(1), post(2)])));
    held[0]?.resolve(json({}));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryState(outpostKeys.detail(OUTPOST_ID))?.isInvalidated).toBe(true);
  });

  it('takes the post back out when the server refuses it and reports why', async () => {
    client.setQueryData(outpostKeys.detail(OUTPOST_ID), detail([post(1)]));
    answers.set(`POST /api/outposts/${OUTPOST_ID}/posts`, () =>
      json({ error: 'The outpost was deleted.' }, 404),
    );
    const { result } = renderHook(() => usePost(OUTPOST_ID), { wrapper });
    act(() => result.current.mutate({ id: postId(2), text: 'a note' }));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('The outpost was deleted.');
    expect(cached()?.posts.map((entry) => entry.id)).toEqual([postId(1)]);
  });

  it('does not draw the same post twice', async () => {
    client.setQueryData(outpostKeys.detail(OUTPOST_ID), detail([post(1)]));
    const { result } = renderHook(() => usePost(OUTPOST_ID), { wrapper });
    act(() => result.current.mutate({ id: postId(1), text: 'again' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(cached()?.posts).toHaveLength(1);
  });
});

describe('the other actions', () => {
  it('cancels a request by id', async () => {
    const { result } = renderHook(() => useCancel(OUTPOST_ID), { wrapper });
    act(() => result.current.mutate(postId(1)));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({
      method: 'POST',
      path: `/api/outposts/${OUTPOST_ID}/posts/${postId(1)}/cancel`,
    });
  });

  it('pauses at once and asks the server', async () => {
    client.setQueryData(outpostKeys.detail(OUTPOST_ID), detail());
    const { result } = renderHook(() => usePause(OUTPOST_ID), { wrapper });
    act(() => result.current.mutate(true));
    await waitFor(() => expect(cached()?.outpost.pausedAt).not.toBeNull());
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({
      method: 'PATCH',
      path: `/api/outposts/${OUTPOST_ID}`,
      body: { paused: true },
    });
  });

  it('answers a Needs you as an ordinary message to that chat', async () => {
    const { result } = renderHook(() => useAnswer(OUTPOST_ID), { wrapper });
    act(() => result.current.mutate({ conversationId: FE_CHAT, text: 'Light theme.' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({
      method: 'POST',
      path: `/api/conversations/${FE_CHAT}/messages`,
      body: { content: 'Light theme.', source: 'ui' },
    });
  });

  it('saves an edit as a rename, then removals, then added and renamed chats', async () => {
    const paths = [
      `PATCH /api/outposts/${OUTPOST_ID}`,
      `DELETE /api/outposts/${OUTPOST_ID}/members/${API_CHAT}`,
      `PUT /api/outposts/${OUTPOST_ID}/members/${FE_CHAT}`,
    ];
    for (const path of paths) answers.set(path, () => json({}));
    const { result } = renderHook(() => useSaveOutpost(OUTPOST_ID), { wrapper });
    act(() =>
      result.current.mutate({
        name: 'Usage filter',
        put: [{ conversationId: FE_CHAT, handle: 'web' }],
        remove: [API_CHAT],
      }),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(paths);
    expect(calls[2]?.body).toEqual({ conversationId: FE_CHAT, handle: 'web' });
  });

  it('adds one chat to an outpost', async () => {
    const { result } = renderHook(() => useAddMember(), { wrapper });
    act(() =>
      result.current.mutate({
        outpostId: OUTPOST_ID,
        member: { conversationId: FE_CHAT, handle: 'fe' },
      }),
    );
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({
      method: 'PUT',
      path: `/api/outposts/${OUTPOST_ID}/members/${FE_CHAT}`,
    });
  });
});
