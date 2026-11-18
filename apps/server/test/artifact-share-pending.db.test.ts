import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/persistence/db.ts';
import { shareSecret } from '../src/setup/secrets.ts';
import { HTML, ShareHarness, sharePath, untilAborted } from './artifact-share-support.ts';

let s: ShareHarness;

beforeEach(async () => {
  s = await ShareHarness.create();
});

afterEach(async () => {
  await s.close();
});

const BODY = { expiresInDays: 7, passcode: true };

const storedThenTimedOut: typeof fetch = async (url, init) => {
  if (init?.method === 'POST') await fetch(url, { ...init, signal: null });
  return untilAborted(init);
};

const lostOnTheWay: typeof fetch = async (url, init) =>
  init?.method === 'POST' ? untilAborted(init) : fetch(url, init);

const limitedDeletes: typeof fetch = async (url, init) =>
  init?.method === 'DELETE'
    ? Response.json({ error: 'rate_limited' }, { status: 429 })
    : fetch(url, init);

const unreachable: typeof fetch = async () => {
  throw new TypeError('fetch failed');
};

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
    expect(await s.states()).toEqual(['pending']);
    expect(await s.secrets.get(shareSecret(first))).not.toBeNull();

    const client = s.client();
    expect((await client.get(sharePath(id)).expect(200)).body.share).toBeNull();
    const early = await client.send('post', sharePath(id), BODY).expect(409);
    expect(early.body.error).toMatch(/still removing an earlier try/);

    await s.makePendingStale();
    const retried = await client.send('post', sharePath(id), BODY).expect(201);
    expect(retried.body.share.shareId).not.toBe(first);
    expect([...s.fake.shares.keys()]).toEqual([retried.body.share.shareId]);
    expect(await s.secrets.get(shareSecret(first))).toBeNull();
    expect(await s.states()).toEqual(['live']);
  });

  it('clears the row at once when the service says no page is there and none can arrive', async () => {
    const id = await s.publish('html', HTML);
    await s
      .client(s.service({ fetch: lostOnTheWay, timeoutMs: 300 }))
      .send('post', sharePath(id), BODY)
      .expect(502);
    expect(s.fake.posts).toHaveLength(0);
    expect(s.fake.answered).toHaveLength(1);
    expect(s.fake.answered[0]).toMatchObject({ method: 'DELETE', status: 404 });
    expect(s.fake.retired.size).toBe(1);
    expect(await s.states()).toEqual([]);
    expect(await s.secrets.get(shareSecret(s.fake.deletes[0]!.id))).toBeNull();
  });

  it('never trusts a bare 404 for a lost upload, and keeps the row and key until its end date', async () => {
    s.fake.retires = false;
    const id = await s.publish('html', HTML);
    await s
      .client(s.service({ fetch: lostOnTheWay, timeoutMs: 300 }))
      .send('post', sharePath(id), BODY)
      .expect(502);
    const shareId = s.fake.deletes[0]!.id;
    expect(await s.states()).toEqual(['pending']);

    await s.makePendingStale();
    await s.sweep();
    await s.sweep();
    expect(s.fake.answered.map((answer) => answer.status)).toEqual([404, 404, 404]);
    expect(await s.states()).toEqual(['pending']);
    expect(await s.secrets.get(shareSecret(shareId))).not.toBeNull();
    const again = await s.client().send('post', sharePath(id), BODY).expect(409);
    expect(again.body.error).toMatch(/still removing an earlier try/);

    await s.t.db.query("UPDATE artifact_page_shares SET expires_at = now() - interval '1 minute'");
    await s.sweep();
    expect(await s.states()).toEqual([]);
    expect(await s.secrets.get(shareSecret(shareId))).toBeNull();
  });

  it('keeps the row and key when the service limits the takedown, and finishes on a later sweep', async () => {
    const id = await s.publish('html', HTML);
    await s
      .client(s.service({ fetch: storedThenTimedOut, timeoutMs: 300 }))
      .send('post', sharePath(id), BODY)
      .expect(502);
    const shareId = s.fake.posts[0]!.id;
    await s.makePendingStale();

    await s.sweep(s.service({ fetch: limitedDeletes }));
    expect(await s.states()).toEqual(['pending']);
    expect(await s.secrets.get(shareSecret(shareId))).not.toBeNull();
    expect(s.fake.shares.has(shareId)).toBe(true);

    await s.sweep();
    expect(await s.states()).toEqual([]);
    expect(s.fake.shares.size).toBe(0);
    expect(await s.secrets.get(shareSecret(shareId))).toBeNull();
  });

  it('keeps an unconfirmed pending row through a failing sweep until its end date', async () => {
    const id = await s.publish('html', HTML);
    await s
      .client(s.service({ fetch: storedThenTimedOut, timeoutMs: 300 }))
      .send('post', sharePath(id), BODY)
      .expect(502);
    await s.makePendingStale();
    await s.sweep(s.service({ fetch: unreachable }));
    expect(await s.states()).toEqual(['pending']);

    await s.t.db.query("UPDATE artifact_page_shares SET expires_at = now() - interval '1 minute'");
    await s.sweep(s.service({ fetch: unreachable }));
    expect(await s.states()).toEqual([]);
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
    expect(await s.states()).toEqual([]);
    expect(await s.secrets.get(shareSecret(sent.id))).toBeNull();
  });
});
