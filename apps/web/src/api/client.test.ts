import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, newDraftId } from './client.ts';

const DEFAULTS = {
  provider: 'claude',
  model: null,
  effort: null,
  permission: 'ask',
  level: 'hands-off',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function serverWithoutChats(): string[] {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push(`${method} ${url}`);
      if (method === 'GET' && url.startsWith('/api/conversations/')) {
        return json({ error: 'Conversation not found.' }, 404);
      }
      return json(DEFAULTS);
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('draft conversations', () => {
  it('builds a new chat locally instead of asking the server for it', async () => {
    const calls = serverWithoutChats();
    const id = newDraftId();
    const detail = await api.getConversation(id);
    expect(detail.conversation.id).toBe(id);
    expect(detail.messages).toEqual([]);
    expect(calls).toEqual(['GET /api/chat-settings/defaults']);
  });

  it('fetches the chat from the server once a settings change has created it', async () => {
    const calls = serverWithoutChats();
    const id = newDraftId();
    await api.updateChatSettings(id, { projectIds: [] });
    await api.getConversation(id);
    expect(calls).toContain(`GET /api/conversations/${id}`);
  });
});

interface DetailServer {
  calls: (string | null)[];
  serve: (title: string, etag: string | null) => void;
}

async function serverWithChat(id: string): Promise<DetailServer> {
  serverWithoutChats();
  const draft = await api.getConversation(newDraftId());
  let etag: string | null = 'W/"v1"';
  let body = { ...draft, conversation: { ...draft.conversation, id, title: 'First' } };
  const server: DetailServer = {
    calls: [],
    serve: (title, next) => {
      etag = next;
      body = { ...body, conversation: { ...body.conversation, title } };
    },
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      const asked = new Headers(init?.headers).get('If-None-Match');
      server.calls.push(asked);
      if (etag && asked === etag)
        return new Response(null, { status: 304, headers: { ETag: etag } });
      const response = json(body);
      if (etag) response.headers.set('ETag', etag);
      return response;
    }),
  );
  return server;
}

describe('fetching a chat that did not change', () => {
  it('asks with the version it holds and reuses the parsed chat on 304', async () => {
    const id = crypto.randomUUID();
    const server = await serverWithChat(id);
    const first = await api.getConversation(id);
    const second = await api.getConversation(id);
    expect(server.calls).toEqual([null, 'W/"v1"']);
    expect(second).toBe(first);
  });

  it('reuses the parsed chat when a full answer carries the version it holds', async () => {
    const id = crypto.randomUUID();
    const server = await serverWithChat(id);
    const first = await api.getConversation(id);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not read', { status: 200, headers: { ETag: 'W/"v1"' } })),
    );
    expect(await api.getConversation(id)).toBe(first);
    expect(server.calls).toEqual([null]);
  });

  it('parses the new chat when the version changed, and holds that one next', async () => {
    const id = crypto.randomUUID();
    const server = await serverWithChat(id);
    await api.getConversation(id);
    server.serve('Second', 'W/"v2"');
    const changed = await api.getConversation(id);
    expect(changed.conversation.title).toBe('Second');
    expect(await api.getConversation(id)).toBe(changed);
    expect(server.calls).toEqual([null, 'W/"v1"', 'W/"v2"']);
  });

  it('always parses when the server sends no version', async () => {
    const id = crypto.randomUUID();
    const server = await serverWithChat(id);
    await api.getConversation(id);
    server.serve('Second', null);
    const second = await api.getConversation(id);
    const third = await api.getConversation(id);
    expect(third).not.toBe(second);
    expect(third).toEqual(second);
    expect(server.calls).toEqual([null, 'W/"v1"', null]);
  });
});
