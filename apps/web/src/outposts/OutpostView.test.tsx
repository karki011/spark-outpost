// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OutpostDetail } from '@spark-outpost/contracts';
import { api, queryKeys } from '../api/client.ts';
import { projectKeys } from '../api/projects.ts';
import { OutpostView } from './OutpostView.tsx';
import { phoneKeys } from '../phone/phone-api.ts';
import { outpostKeys } from './outposts-api.ts';
import {
  API_CHAT,
  FE_CHAT,
  OUTPOST_ID,
  chat,
  detail,
  note,
  notice,
  post,
} from './test-fixtures.ts';

interface Call {
  method: string;
  path: string;
  body: unknown;
}

class QuietResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

const SENT = {} as Awaited<ReturnType<typeof api.sendMessage>>;

let client: QueryClient;
let calls: Call[];
let served: OutpostDetail | null;

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status });
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(queryKeys.conversations, [
    chat(FE_CHAT, { title: 'Usage page' }),
    chat(API_CHAT, { title: 'Usage endpoint' }),
  ]);
  client.setQueryData(projectKeys.all, []);
  calls = [];
  served = null;
  vi.stubGlobal('ResizeObserver', QuietResizeObserver);
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method !== 'GET') {
        const body = JSON.parse(String(init?.body ?? 'null')) as { id?: string };
        calls.push({ method, path: url, body });
        if (served && body.id && url.endsWith('/posts')) {
          const stored = post(9, { id: body.id, body: 'add the filter' });
          served = { ...served, posts: [...served.posts, stored] };
        }
        return Promise.resolve(json({}));
      }
      if (url === `/api/outposts/${OUTPOST_ID}` && served) return Promise.resolve(json(served));
      return Promise.resolve(json({ error: 'Outpost not found.' }, 404));
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function view(onOpenChat = vi.fn<(id: string) => void>(), onGone = vi.fn<() => void>()) {
  return render(
    <QueryClientProvider client={client}>
      <OutpostView id={OUTPOST_ID} onOpenChat={onOpenChat} onGone={onGone} />
    </QueryClientProvider>,
  );
}

function show(data: OutpostDetail): void {
  served = data;
  client.setQueryData(outpostKeys.detail(OUTPOST_ID), data);
}

describe('OutpostView', () => {
  it('shows the name, the chats, the thread and one message box', () => {
    show(
      detail([
        notice(1, '@api joined. @fe and @api can now ask each other.'),
        post(2, { state: 'working' }),
        note(3),
      ]),
    );
    view();
    expect(screen.getByRole('heading', { level: 1, name: 'Usage by user' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /You and 2 chats/ })).toBeTruthy();
    expect(within(screen.getByRole('toolbar')).getAllByRole('button')).toHaveLength(2);
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
  });

  it('opens a chat from the strip and from a request', () => {
    show(detail([post(1)]));
    const onOpenChat = vi.fn<(id: string) => void>();
    view(onOpenChat);
    fireEvent.click(within(screen.getByRole('toolbar')).getAllByRole('button')[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Open @api in chat' }));
    expect(onOpenChat.mock.calls).toEqual([[FE_CHAT], [API_CHAT]]);
  });

  it('posts a request from the message box and shows it at once', async () => {
    show(detail());
    view();
    expect(screen.getByText('Nothing here yet')).toBeTruthy();
    const box = screen.getByRole('combobox');
    fireEvent.change(box, { target: { value: '@api add the filter' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByText('add the filter')).toBeTruthy();
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({
      method: 'POST',
      path: `/api/outposts/${OUTPOST_ID}/posts`,
      body: { text: '@api add the filter' },
    });
  });

  it('answers a Needs you in the main box, as a message to that chat', async () => {
    const sendMessage = vi.spyOn(api, 'sendMessage').mockResolvedValue(SENT);
    show(detail([post(1, { state: 'needs_you', reason: 'Light or dark theme?' })]));
    view();
    fireEvent.click(screen.getByRole('button', { name: 'Answer' }));
    expect(screen.getByText('Answering').textContent).toBe('Answering @api');
    const box = screen.getByRole('combobox');
    expect(document.activeElement).toBe(box);
    fireEvent.change(box, { target: { value: 'Light.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send answer' }));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    expect(sendMessage.mock.calls[0]?.[0]).toBe(API_CHAT);
    expect(sendMessage.mock.calls[0]?.[2]).toBe('Light.');
    expect(calls).toEqual([]);
    await waitFor(() => expect(screen.queryByText('Answering')).toBeNull());
  });

  it('offers only Open in chat while the chat waits on an approval card', () => {
    client.setQueryData(queryKeys.conversations, [
      chat(FE_CHAT, { title: 'Usage page' }),
      chat(API_CHAT, {
        title: 'Usage endpoint',
        latestRun: {
          id: '0e000000-0000-4000-8000-000000000001',
          status: 'awaiting_approval',
          error: null,
          step: null,
          provider: null,
          progress: null,
        },
      }),
    ]);
    show(
      detail([
        post(1, { state: 'needs_you', reason: '@api is waiting for your approval' }),
        post(2, {
          state: 'needs_you',
          reason: 'Light or dark theme?',
          toConversationId: FE_CHAT,
          toHandle: 'fe',
        }),
      ]),
    );
    view();
    expect(screen.getByText('@api is waiting for your approval')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Answer' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Open @api in chat' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Answer' }));
    expect(screen.getByText('Answering').textContent).toBe('Answering @fe');
  });

  it('stops answering when the request is no longer waiting for the user', async () => {
    show(detail([post(1, { state: 'needs_you' })]));
    view();
    fireEvent.click(screen.getByRole('button', { name: 'Answer' }));
    expect(screen.getByText('Answering')).toBeTruthy();
    show(detail([post(1, { state: 'working' })]));
    await waitFor(() => expect(screen.queryByText('Answering')).toBeNull());
    expect(screen.getByRole('button', { name: 'Post note' })).toBeTruthy();
  });

  it('cancels a request and pauses the outpost', async () => {
    show(detail([post(1, { state: 'working' })]));
    view();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel request to @api' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      `POST /api/outposts/${OUTPOST_ID}/posts/${post(1).id}/cancel`,
      `PATCH /api/outposts/${OUTPOST_ID}`,
    ]);
    expect(calls[1]?.body).toEqual({ paused: true });
  });

  it('says it is paused and offers Resume', () => {
    show(detail([], { pausedAt: '2026-10-09T10:30:00.000Z' }));
    view();
    expect(screen.getByRole('button', { name: 'Resume' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByRole('status').textContent).toContain('Paused.');
  });

  it('invites adding chats to an outpost with none, through the edit sheet', () => {
    show(detail([], { members: [] }));
    view();
    expect(screen.getByText('No chats here yet')).toBeTruthy();
    expect(screen.queryByRole('toolbar')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add chats' }));
    expect(screen.getByRole('dialog', { name: 'Edit outpost' })).toBeTruthy();
  });

  it('on a paired phone renames only: no chats to add, no handles, no delete', () => {
    client.setQueryData(phoneKeys.session, { remote: true, device: null, address: null });
    show(detail([], { members: [] }));
    view();
    expect(screen.getByText('Chats are added on your Mac.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add chats' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Edit outpost' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Edit outpost' }));
    expect(dialog.getAllByRole('textbox')).toHaveLength(1);
    expect(dialog.queryByRole('button', { name: /Hold to delete outpost/ })).toBeNull();
    expect(dialog.queryByRole('button', { name: 'Add a chat' })).toBeNull();
  });

  it('says so when the outpost was deleted and offers the way back', async () => {
    const onGone = vi.fn<() => void>();
    view(vi.fn<(id: string) => void>(), onGone);
    expect(await screen.findByText('This outpost was deleted')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back to chats' }));
    expect(onGone).toHaveBeenCalledTimes(1);
  });
});
