import { describe, expect, it } from 'vitest';
import type { CustomKeyHeader } from '@spark-outpost/contracts';
import { askEndpoint } from './custom-endpoint-check.ts';

const KEY = 'gateway-private-credential';

function stored(apiKey: string, keyHeader: CustomKeyHeader = 'bearer') {
  return { baseUrl: 'http://localhost:11434', model: 'qwen3', fastModel: '', apiKey, keyHeader };
}

function replying(status: number, body: unknown, seen: Request[] = []) {
  return {
    fetch: (async (input: Request) => {
      seen.push(input);
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch,
  };
}

const ok = { type: 'message', model: 'qwen3', content: [] };

describe('askEndpoint', () => {
  it.each([401, 404, 429, 500])(
    'never repeats the API key the server echoed (%i)',
    async (status) => {
      const reply = await askEndpoint(
        stored(KEY),
        replying(status, { error: { message: `bad token ${KEY} for ${KEY}` } }),
        1000,
      );
      expect(reply.ok).toBe(false);
      if (reply.ok) return;
      expect(reply.reason).not.toContain(KEY);
      expect(reply.reason).toContain('The server said: bad token [redacted] for [redacted]');
    },
  );

  it('keeps the server message when there is no key', async () => {
    const reply = await askEndpoint(stored(''), replying(500, { error: 'model not loaded' }), 1000);
    expect(reply).toEqual({
      ok: false,
      reason: 'The endpoint responded with 500. The server said: model not loaded',
    });
  });

  it('drops the server message when a short key appears in it', async () => {
    const reply = await askEndpoint(stored('k9z'), replying(401, { error: 'bad token k9z' }), 1000);
    expect(reply.ok || reply.reason).toBe(
      'The endpoint refused the request (401). Check the API key.',
    );
  });

  it('keeps the server message when a short key is not in it', async () => {
    const reply = await askEndpoint(
      stored('k9z'),
      replying(500, { error: 'model not loaded' }),
      1000,
    );
    expect(reply.ok || reply.reason).toBe(
      'The endpoint responded with 500. The server said: model not loaded',
    );
  });

  it('names the configured model, never what the server put in its reply', async () => {
    const reply = await askEndpoint(
      stored(KEY),
      replying(200, { type: 'message', model: `echo ${KEY}`, content: [] }),
      1000,
    );
    expect(reply).toEqual({ ok: true, model: 'qwen3' });
  });

  it('sends the key as a bearer token by default', async () => {
    const seen: Request[] = [];
    await askEndpoint(stored(KEY), replying(200, ok, seen), 1000);
    expect(seen[0]?.headers.get('authorization')).toBe(`Bearer ${KEY}`);
    expect(seen[0]?.headers.get('x-api-key')).toBeNull();
  });

  it('sends the key only in x-api-key when chosen', async () => {
    const seen: Request[] = [];
    await askEndpoint(stored(KEY, 'x-api-key'), replying(200, ok, seen), 1000);
    expect(seen[0]?.headers.get('x-api-key')).toBe(KEY);
    expect(seen[0]?.headers.get('authorization')).toBeNull();
  });

  it('sends the placeholder as a bearer token when there is no key', async () => {
    const seen: Request[] = [];
    await askEndpoint(stored('', 'x-api-key'), replying(200, ok, seen), 1000);
    expect(seen[0]?.headers.get('authorization')).toBe('Bearer spark-outpost-no-key');
    expect(seen[0]?.headers.get('x-api-key')).toBeNull();
  });
});
