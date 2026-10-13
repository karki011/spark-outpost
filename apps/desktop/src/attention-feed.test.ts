import { describe, expect, it, vi } from 'vitest';
import type { AttentionReport } from '@spark-outpost/contracts';
import { changesChatList, eventFrames, startAttentionFeed } from './attention-feed.ts';

const CHAT = '11111111-2222-4333-8444-555555555555';
const ORIGIN = 'http://127.0.0.1:31000';

function waitingChat(needsInput: boolean) {
  return {
    id: CHAT,
    title: 'Fix login',
    updatedAt: '2026-10-12T10:00:00.000Z',
    projectIds: [],
    latestRun: null,
    archivedAt: null,
    pinnedAt: null,
    pinnedOrder: null,
    projectOrder: null,
    unread: false,
    needsInput,
    attention: null,
    titleSource: 'message',
    category: null,
  };
}

function frame(kind: string): string {
  return `data: ${JSON.stringify({ kind, conversationId: CHAT, runId: null })}\n\n`;
}

interface Server {
  fetchImpl: typeof fetch;
  send(text: string): void;
  end(): void;
  lists: () => number;
  streams: () => number;
  setChats(chats: unknown[]): void;
}

function server(): Server {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let chats: unknown[] = [];
  let lists = 0;
  let streams = 0;
  const fetchImpl = ((input: string, init?: RequestInit) => {
    if (input === `${ORIGIN}/api/conversations`) {
      lists += 1;
      return Promise.resolve(Response.json(chats));
    }
    streams += 1;
    const body = new ReadableStream<Uint8Array>({
      start(next) {
        controller = next;
        init?.signal?.addEventListener('abort', () => next.error(new Error('stopped')));
      },
    });
    return Promise.resolve(new Response(body, { status: 200 }));
  }) as typeof fetch;
  return {
    fetchImpl,
    send: (text) => controller?.enqueue(encoder.encode(text)),
    end: () => controller?.close(),
    lists: () => lists,
    streams: () => streams,
    setChats: (next) => {
      chats = next;
    },
  };
}

function feedOn(api: Server) {
  const reports: AttentionReport[] = [];
  const feed = startAttentionFeed({
    origin: ORIGIN,
    token: 'token',
    fetchImpl: api.fetchImpl,
    reconnectMs: 1,
    onReport: (report) => reports.push(report),
  });
  return { feed, reports };
}

describe('eventFrames', () => {
  it('returns each complete data frame and keeps the unfinished rest', () => {
    expect(eventFrames('retry: 2000\n\ndata: {"a":1}\n\ndata: {"b"')).toEqual({
      data: ['{"a":1}'],
      rest: 'data: {"b"',
    });
  });

  it('ignores keep-alive comments', () => {
    expect(eventFrames(': keep-alive\n\n')).toEqual({ data: [], rest: '' });
  });
});

describe('changesChatList', () => {
  it('follows the events that change which chats wait', () => {
    expect(
      changesChatList(JSON.stringify({ kind: 'approval', conversationId: CHAT, runId: null })),
    ).toBe(true);
    expect(
      changesChatList(JSON.stringify({ kind: 'run', conversationId: CHAT, runId: null })),
    ).toBe(true);
  });

  it('skips step events and anything that is not an app event', () => {
    expect(
      changesChatList(JSON.stringify({ kind: 'step', conversationId: CHAT, runId: null })),
    ).toBe(false);
    expect(changesChatList('not json')).toBe(false);
  });
});

describe('startAttentionFeed', () => {
  it('reports the waiting chats once the stream connects', async () => {
    const api = server();
    api.setChats([waitingChat(true)]);
    const { feed, reports } = feedOn(api);
    await vi.waitFor(() => expect(reports).toHaveLength(1));
    expect(reports[0]).toMatchObject({ count: 1, requests: [{ chatId: CHAT, chat: 'Fix login' }] });
    feed.stop();
  });

  it('reads the list again when an approval event arrives, split across chunks', async () => {
    const api = server();
    const { feed, reports } = feedOn(api);
    await vi.waitFor(() => expect(reports).toHaveLength(1));
    api.setChats([waitingChat(true)]);
    const text = frame('approval');
    api.send(text.slice(0, 20));
    api.send(text.slice(20));
    await vi.waitFor(() => expect(reports).toHaveLength(2));
    expect(reports.map((report) => report.count)).toEqual([0, 1]);
    feed.stop();
  });

  it('reports only when the waiting chats changed', async () => {
    const api = server();
    const { feed, reports } = feedOn(api);
    await vi.waitFor(() => expect(reports).toHaveLength(1));
    api.send(frame('run'));
    await vi.waitFor(() => expect(api.lists()).toBe(2));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(reports).toHaveLength(1);
    api.setChats([waitingChat(true)]);
    api.send(frame('approval'));
    await vi.waitFor(() => expect(reports).toHaveLength(2));
    expect(api.lists()).toBe(3);
    feed.stop();
  });

  it('does not read the list for step events', async () => {
    const api = server();
    const { feed, reports } = feedOn(api);
    await vi.waitFor(() => expect(reports).toHaveLength(1));
    api.send(frame('step'));
    api.send(frame('approval'));
    await vi.waitFor(() => expect(api.lists()).toBe(2));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api.lists()).toBe(2);
    feed.stop();
  });

  it('connects again after the stream ends and reads the list again', async () => {
    const api = server();
    const { feed, reports } = feedOn(api);
    await vi.waitFor(() => expect(reports).toHaveLength(1));
    api.end();
    await vi.waitFor(() => expect(api.streams()).toBe(2));
    await vi.waitFor(() => expect(api.lists()).toBe(2));
    feed.stop();
  });

  it('reports nothing after it is stopped', async () => {
    const api = server();
    const { feed, reports } = feedOn(api);
    await vi.waitFor(() => expect(reports).toHaveLength(1));
    feed.stop();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(reports).toHaveLength(1);
    expect(api.lists()).toBe(1);
    expect(api.streams()).toBe(1);
  });
});
