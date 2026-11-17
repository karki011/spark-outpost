import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/persistence/db.ts';
import { shareSecret } from '../src/setup/secrets.ts';
import { HTML, ShareHarness, sharePath } from './artifact-share-support.ts';

let s: ShareHarness;

beforeEach(async () => {
  s = await ShareHarness.create();
});

afterEach(async () => {
  await s.close();
});

const BODY = { expiresInDays: 7, passcode: true };

function untilAborted(init: RequestInit | undefined): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
  });
}

const storedThenTimedOut: typeof fetch = async (url, init) => {
  if (init?.method === 'POST') await fetch(url, { ...init, signal: null });
  return untilAborted(init);
};

const lostOnTheWay: typeof fetch = async (url, init) =>
  init?.method === 'POST' ? untilAborted(init) : fetch(url, init);

async function states(): Promise<string[]> {
  const { rows } = await s.t.db.query<{ state: string }>(
    'SELECT state FROM artifact_page_shares ORDER BY created_at',
  );
  return rows.map((row) => row.state);
}

async function makePendingStale(): Promise<void> {
  await s.t.db.query(
    "UPDATE artifact_page_shares SET created_at = now() - interval '2 minutes' WHERE state = 'pending'",
  );
}

function failAuditWrites(): void {
  const connect = s.t.db.connect.bind(s.t.db);
  s.t.db.connect = (async (...args: unknown[]) => {
    if (args.length > 0) return (connect as (...rest: unknown[]) => unknown)(...args);
    const client = await connect();
    return new Proxy(client, {
      get(target, key) {
        if (key !== 'query') {
          const value: unknown = Reflect.get(target, key, target);
          return typeof value === 'function' ? value.bind(target) : value;
        }
        return (text: unknown, ...rest: unknown[]) =>
          typeof text === 'string' &&
          text.includes('INSERT INTO run_protocol_log') &&
          JSON.stringify(rest).includes('spark/artifact_share')
            ? Promise.reject(new Error('audit log is full'))
            : (target.query as (...args: unknown[]) => unknown)(text, ...rest);
      },
    });
  }) as Db['connect'];
}

describe('a share whose upload has no clear answer', { timeout: 30_000 }, () => {
  it('keeps a pending row and its key when the page may exist, never shows it as shared, and retries with a fresh id', async () => {
    const id = await s.publish('html', HTML);
    const slow = s.client(s.service({ fetch: storedThenTimedOut, timeoutMs: 300 }));
    const failed = await slow.send('post', sharePath(id), BODY).expect(502);
    expect(failed.body.error).toMatch(/couldn't reach/);
    const first = s.fake.posts[0]!.id;
    expect(s.fake.shares.has(first)).toBe(true);
    expect(await states()).toEqual(['pending']);
    expect(await s.secrets.get(shareSecret(first))).not.toBeNull();

    const client = s.client();
    expect((await client.get(sharePath(id)).expect(200)).body.share).toBeNull();
    const early = await client.send('post', sharePath(id), BODY).expect(409);
    expect(early.body.error).toMatch(/still removing an earlier try/);

    await makePendingStale();
    const retried = await client.send('post', sharePath(id), BODY).expect(201);
    expect(retried.body.share.shareId).not.toBe(first);
    expect([...s.fake.shares.keys()]).toEqual([retried.body.share.shareId]);
    expect(await s.secrets.get(shareSecret(first))).toBeNull();
    expect(await states()).toEqual(['live']);
  });

  it('does not trust a 404 right after a lost upload, and the sweep clears it a minute later', async () => {
    const id = await s.publish('html', HTML);
    await s
      .client(s.service({ fetch: lostOnTheWay, timeoutMs: 300 }))
      .send('post', sharePath(id), BODY)
      .expect(502);
    expect(s.fake.posts).toHaveLength(0);
    expect(s.fake.deletes).toHaveLength(1);
    expect(await states()).toEqual(['pending']);

    await s.sweep();
    expect(await states()).toEqual(['pending']);

    await makePendingStale();
    await s.sweep();
    expect(s.fake.deletes).toHaveLength(2);
    expect(await states()).toEqual([]);
  });

  it('keeps an unconfirmed pending row through a failing sweep until its end date', async () => {
    const id = await s.publish('html', HTML);
    await s
      .client(s.service({ fetch: storedThenTimedOut, timeoutMs: 300 }))
      .send('post', sharePath(id), BODY)
      .expect(502);
    await makePendingStale();
    await s.sweep(s.service({ origin: 'http://127.0.0.1:1' }));
    expect(await states()).toEqual(['pending']);

    await s.t.db.query("UPDATE artifact_page_shares SET expires_at = now() - interval '1 minute'");
    await s.sweep(s.service({ origin: 'http://127.0.0.1:1' }));
    expect(await states()).toEqual([]);
    expect(await s.secrets.get(shareSecret(s.fake.posts[0]!.id))).toBeNull();
  });
});

describe('a share whose audit entry cannot be written', { timeout: 30_000 }, () => {
  it('is never live: the page comes down, the row and key go, and the passcode is not sent back', async () => {
    const id = await s.publish('html', HTML);
    failAuditWrites();
    const failed = await s.client().send('post', sharePath(id), BODY).expect(500);
    const sent = s.fake.posts[0]!;
    expect(JSON.stringify(failed.body)).not.toContain(sent.passcode!);
    expect(s.fake.deletes.map((entry) => entry.id)).toEqual([sent.id]);
    expect(s.fake.shares.size).toBe(0);
    expect(await states()).toEqual([]);
    expect(await s.secrets.get(shareSecret(sent.id))).toBeNull();
  });
});
