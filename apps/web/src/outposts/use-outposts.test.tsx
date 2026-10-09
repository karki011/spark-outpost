// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OutpostDetail } from '@spark-outpost/contracts';
import { mergeInvalidations } from '../app/live/app-event-keys.ts';
import { outpostKeys } from './outposts-api.ts';
import {
  API_CHAT,
  FE_CHAT,
  OUTPOST_ID,
  detail,
  member,
  outpost,
  post,
  postId,
} from './test-fixtures.ts';
import {
  optimisticPost,
  useAddMember,
  useAnswer,
  useCancel,
  useCreateOutpost,
  useDeleteOutpost,
  useOutpost,
  useOutposts,
  usePause,
  usePost,
  useSaveOutpost,
  useStartNow,
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
  it('shows the post at once, sends it with its id, then keeps what the server returned', async () => {
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
    const sent = post(2, { state: 'working', reason: null });
    held[0]?.resolve(json(detail([post(1), sent]), 201));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(cached()?.posts).toEqual([post(1), sent]);
    expect(calls).toHaveLength(1);
  });

  it('takes the post back out when the server refuses it and reports why', async () => {
    client.setQueryData(outpostKeys.detail(OUTPOST_ID), detail([post(1)]));
    answers.set(`POST /api/outposts/${OUTPOST_ID}/posts`, () =>
      json({ error: 'The outpost was deleted.' }, 404),
    );
    answers.set(`GET /api/outposts/${OUTPOST_ID}`, () => json(detail([post(1)])));
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
  it('cancels a request by id and shows the state the server returned', async () => {
    client.setQueryData(outpostKeys.detail(OUTPOST_ID), detail([post(1)]));
    const cancelled = post(1, { state: 'cancelled' });
    const path = `/api/outposts/${OUTPOST_ID}/posts/${postId(1)}/cancel`;
    answers.set(`POST ${path}`, () => json(detail([cancelled])));
    const { result } = renderHook(() => useCancel(OUTPOST_ID), { wrapper });
    act(() => result.current.mutate(postId(1)));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calls).toEqual([{ method: 'POST', path, body: {} }]);
    expect(cached()?.posts).toEqual([cancelled]);
  });

  it('starts a held request now and keeps what the server answers', async () => {
    const released = post(1, { reason: 'Not sent yet' });
    const path = `/api/outposts/${OUTPOST_ID}/posts/${postId(1)}/start-now`;
    answers.set(`POST ${path}`, () => json(detail([released])));
    const { result } = renderHook(() => useStartNow(OUTPOST_ID), { wrapper });
    act(() => result.current.mutate(postId(1)));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calls).toEqual([{ method: 'POST', path, body: {} }]);
    expect(cached()?.posts).toEqual([released]);
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
    const saved = detail([], { name: 'Usage filter', members: [member(FE_CHAT, 'web', 1)] });
    for (const path of paths) answers.set(path, () => json(saved));
    client.setQueryData(outpostKeys.list, [outpost()]);
    const { result } = renderHook(() => useSaveOutpost(OUTPOST_ID), { wrapper });
    act(() =>
      result.current.mutate({
        name: 'Usage filter',
        put: [{ conversationId: FE_CHAT, handle: 'web' }],
        remove: [API_CHAT],
      }),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calls.slice(0, 3).map((call) => `${call.method} ${call.path}`)).toEqual(paths);
    expect(calls[1]?.body).toBeNull();
    expect(calls[2]?.body).toEqual({ handle: 'web' });
    expect(cached()).toEqual(saved);
    expect(client.getQueryData(outpostKeys.list)).toEqual([saved.outpost]);
  });

  it('adds one chat to an outpost and lists the outpost with it', async () => {
    const joined = detail([], { members: [member(FE_CHAT, 'fe', 1)] });
    answers.set(`PUT /api/outposts/${OUTPOST_ID}/members/${FE_CHAT}`, () => json(joined));
    client.setQueryData(outpostKeys.list, [outpost({ members: [] })]);
    const { result } = renderHook(() => useAddMember(), { wrapper });
    act(() =>
      result.current.mutate({
        outpostId: OUTPOST_ID,
        member: { conversationId: FE_CHAT, handle: 'fe' },
      }),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calls[0]).toEqual({
      method: 'PUT',
      path: `/api/outposts/${OUTPOST_ID}/members/${FE_CHAT}`,
      body: { handle: 'fe' },
    });
    expect(client.getQueryData(outpostKeys.list)).toEqual([joined.outpost]);
  });

  it('creates an outpost and lists it without asking again', async () => {
    const created = detail();
    answers.set('POST /api/outposts', () => json(created, 201));
    client.setQueryData(outpostKeys.list, []);
    const { result } = renderHook(() => useCreateOutpost(), { wrapper });
    act(() => result.current.mutate({ id: OUTPOST_ID, name: 'Usage by user', members: [] }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(cached()).toEqual(created);
    expect(client.getQueryData(outpostKeys.list)).toEqual([created.outpost]);
    expect(calls.filter((call) => call.path.startsWith('/api/outposts'))).toHaveLength(1);
  });

  it('deletes an outpost with no request body and drops it from the list', async () => {
    answers.set(`DELETE /api/outposts/${OUTPOST_ID}`, () => new Response(null, { status: 204 }));
    client.setQueryData(outpostKeys.list, [outpost()]);
    client.setQueryData(outpostKeys.detail(OUTPOST_ID), detail());
    const { result } = renderHook(() => useDeleteOutpost(OUTPOST_ID), { wrapper });
    act(() => result.current.mutate());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calls[0]).toEqual({ method: 'DELETE', path: `/api/outposts/${OUTPOST_ID}`, body: null });
    expect(client.getQueryData(outpostKeys.list)).toEqual([]);
    expect(cached()).toBeUndefined();
  });
});
