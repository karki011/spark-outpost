import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sha256Of, newViewKey, writeVersionFile } from '../src/artifacts/files.ts';
import { insertVersion } from '../src/artifacts/store.ts';
import { chatArtifactsFolder } from '../src/chat-files/folders.ts';
import type { Db } from '../src/persistence/db.ts';
import { shareSecret } from '../src/setup/secrets.ts';
import { HTML, ShareHarness, sharePath } from './artifact-share-support.ts';
import type { StoredShare } from './fake-share-service.ts';

let s: ShareHarness;

beforeEach(async () => {
  s = await ShareHarness.create();
});

afterEach(async () => {
  await s.close();
});

const BODY = { expiresInDays: 1, passcode: true };

function answerInsert(answer: () => Promise<unknown>): void {
  const query = s.t.db.query.bind(s.t.db);
  s.t.db.query = ((text: unknown, ...rest: unknown[]) =>
    typeof text === 'string' && text.includes('INSERT INTO artifact_page_shares')
      ? answer()
      : (query as (...args: unknown[]) => unknown)(text, ...rest)) as Db['query'];
}

async function noShares() {
  expect(await s.rows('artifact_page_shares')).toBe('[]');
}

describe('sharing an artifact when something is wrong', { timeout: 30_000 }, () => {
  it('says sharing is unavailable when the build has no share service', async () => {
    const id = await s.publish('html', HTML);
    const client = s.client(null);
    expect((await client.get(sharePath(id)).expect(200)).body).toEqual({
      available: false,
      service: null,
      host: null,
      days: [],
      share: null,
    });
    const refused = await client.send('post', sharePath(id), BODY).expect(503);
    expect(refused.body.error).toMatch(/not set up/);
    await client.send('delete', sharePath(id)).expect(503);
    expect(s.fake.posts).toHaveLength(0);
  });

  it('refuses a version whose file changed since it was stored', async () => {
    const id = await s.publish('html', HTML);
    const file = join(
      chatArtifactsFolder(s.artifacts.base, s.artifacts.chat.conversationId),
      id,
      '1',
    );
    await writeFile(file, '<script>other()</script>');
    await s.client().send('post', sharePath(id), BODY).expect(409);
    expect(s.fake.posts).toHaveLength(0);
    await noShares();
  });

  it('refuses a version that was never shown', async () => {
    const id = await s.publish('html', HTML);
    const text = '<p>declined</p>';
    await insertVersion(s.t.db, {
      artifactId: id,
      conversationId: s.artifacts.chat.conversationId,
      kind: 'html',
      version: 2,
      title: 'Declined',
      bytes: Buffer.byteLength(text),
      sha256: sha256Of(text),
      viewKey: newViewKey(),
      runId: null,
    });
    await writeVersionFile(s.artifacts.base, s.artifacts.chat.conversationId, id, 2, text);
    await s.client().send('post', sharePath(id, 2), BODY).expect(404);
    expect(s.fake.posts).toHaveLength(0);
  });

  it('gives a one-line error, takes the try down once and keeps nothing when the service says no', async () => {
    const id = await s.publish('html', HTML);
    const client = s.client();
    for (const [status, message] of [
      [413, /too large/],
      [429, /busy/],
      [400, /didn't accept/],
      [500, /answered 500/],
    ] as const) {
      s.fake.answer = () => ({ status, body: { error: 'nope' } });
      const failed = await client.send('post', sharePath(id), BODY).expect(502);
      expect(failed.body.error).toMatch(message);
      expect(failed.body.error).not.toContain('\n');
    }
    expect(s.fake.deletes.map((entry) => entry.id)).toEqual(s.fake.posts.map((post) => post.id));
    for (const post of s.fake.posts) expect(await s.secrets.get(shareSecret(post.id))).toBeNull();
    await noShares();
  });

  it('refuses an answer for another id, on another origin or malformed, and takes it down', async () => {
    const id = await s.publish('html', HTML);
    const client = s.client();
    const stored = (share: StoredShare, body: Record<string, unknown>) => {
      s.fake.shares.set(share.id, share);
      return { status: 201, body: { expiresAt: new Date().toISOString(), ...body } };
    };
    s.fake.answer = (share) =>
      stored(share, { id: share.id, url: `https://elsewhere.example/a/${share.id}` });
    const elsewhere = await client.send('post', sharePath(id), BODY).expect(502);
    expect(elsewhere.body.error).toMatch(/could not use/);

    s.fake.answer = (share, origin) =>
      stored(share, { id: 'A'.repeat(22), url: `${origin}/a/${'A'.repeat(22)}` });
    await client.send('post', sharePath(id), BODY).expect(502);

    s.fake.answer = (share) => stored(share, { id: share.id });
    await client.send('post', sharePath(id), BODY).expect(502);

    expect(s.fake.shares.size).toBe(0);
    expect(s.fake.deletes).toHaveLength(3);
    await noShares();
  });

  it('never follows a redirect', async () => {
    const id = await s.publish('html', HTML);
    const seen: RequestInit[] = [];
    const redirecting: typeof fetch = async (url, init) => {
      seen.push(init ?? {});
      return fetch(url, init);
    };
    s.fake.answer = (share, origin) => ({
      status: 307,
      body: {},
      headers: { location: `${origin}/v1/elsewhere/${share.id}` },
    });
    const client = s.client(s.service({ fetch: redirecting }));
    await client.send('post', sharePath(id), BODY).expect(502);
    expect(seen.map((init) => init.method)).toEqual(['POST', 'DELETE']);
    expect(seen.every((init) => init.redirect === 'error')).toBe(true);
    expect(s.fake.posts).toHaveLength(1);
    expect((await s.client().get(sharePath(id)).expect(200)).body.share).toBeNull();
  });

  it('keeps the key when the save of the pending link fails, and uploads nothing', async () => {
    const id = await s.publish('html', HTML);
    const kept: string[] = [];
    const set = s.secrets.set.bind(s.secrets);
    s.secrets.set = (provider, secret) => {
      kept.push(provider);
      return set(provider, secret);
    };
    answerInsert(() => Promise.reject(new Error('disk is full')));
    await s.client().send('post', sharePath(id), BODY).expect(500);
    expect(s.fake.posts).toHaveLength(0);
    expect(kept).toHaveLength(1);
    expect(await s.secrets.get(kept[0] as `share:${string}`)).toBeNull();
  });

  it('uploads nothing when the delete key cannot be kept', async () => {
    const id = await s.publish('html', HTML);
    s.secrets.set = () => Promise.reject(new Error('keychain locked'));
    const failed = await s.client().send('post', sharePath(id), BODY).expect(409);
    expect(failed.body.error).toMatch(/keychain/);
    expect(s.fake.posts).toHaveLength(0);
    await noShares();
  });
});
