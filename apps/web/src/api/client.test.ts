import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, newDraftId } from './client.ts';

const DEFAULTS = {
  provider: 'claude',
  model: null,
  effort: null,
  permission: 'ask',
  level: 'balanced',
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
