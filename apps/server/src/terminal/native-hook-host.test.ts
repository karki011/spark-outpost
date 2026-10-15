import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nativeHookHost } from './native-hook-host.ts';

let host: Awaited<ReturnType<typeof nativeHookHost>>;
let asked: string[];

beforeEach(async () => {
  asked = [];
  host = await nativeHookHost(
    (token) => token === 'good' || token === 'codex',
    async () => true,
    async () => null,
    async (token) => {
      asked.push(token);
      return token === 'good' ? { messages: ['hi'], notices: [], status: null } : null;
    },
  );
});

afterEach(async () => {
  await host.close();
});

function inbox(token: string, init: RequestInit = {}) {
  return fetch(new URL('/mod/inbox', host.url), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: '{}',
    ...init,
  });
}

describe('the mod inbox on the hook host', () => {
  it('answers the session’s own mod with its inbox', async () => {
    const response = await inbox('good');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ messages: ['hi'], notices: [], status: null });
    expect(asked).toEqual(['good']);
  });

  it('accepts only a live session token', async () => {
    expect((await inbox('stolen')).status).toBe(401);
    expect((await inbox('codex')).status).toBe(404);
    expect(asked).toEqual(['codex']);
  });

  it('refuses requests a web page could make', async () => {
    const page = await inbox('good', {
      headers: { Authorization: 'Bearer good', Origin: 'http://example.com' },
    });
    expect(page.status).toBe(403);
    expect((await inbox('good', { method: 'GET', body: null })).status).toBe(405);
    expect(asked).toEqual([]);
  });
});
