import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CLOUDFLARE_UPLOAD_KEY_SECRET } from '../src/setup/secrets.ts';
import {
  HTML,
  ShareHarness,
  UPLOAD_KEY,
  sharePath,
  startFakeWorker,
  type FakeWorker,
} from './artifact-share-support.ts';

let s: ShareHarness;
let own: FakeWorker;

beforeEach(async () => {
  s = await ShareHarness.create();
  own = await startFakeWorker();
});

afterEach(async () => {
  await own.close();
  await s.close();
});

describe('which share service an artifact goes to', { timeout: 30_000 }, () => {
  it('reports the service, its host and the days a new link may last', async () => {
    const id = await s.publish('html', HTML);
    const status = async (client: ReturnType<ShareHarness['client']>) =>
      (await client.get(sharePath(id)).expect(200)).body;

    expect(await status(s.client(s.service({ origin: null })))).toEqual({
      available: false,
      service: null,
      host: null,
      days: [],
      share: null,
    });
    expect(await status(s.client())).toEqual({
      available: true,
      service: 'hosted',
      host: new URL(s.origin).host,
      days: [1],
      share: null,
    });

    await s.connectOwn(own);
    const connected = {
      available: true,
      service: 'own',
      host: new URL(own.origin).host,
      days: [1, 7],
      share: null,
    };
    expect(await status(s.client())).toEqual(connected);
    expect(await status(s.client(s.service({ origin: null })))).toEqual(connected);
  });

  it('uploads to the user’s own service with the upload key, for 7 days', async () => {
    await s.connectOwn(own);
    const id = await s.publish('html', HTML);
    const client = s.client();

    const made = await client
      .send('post', sharePath(id), { expiresInDays: 7, passcode: false })
      .expect(201);

    expect(s.fake.posts).toHaveLength(0);
    const [sent] = own.fake.posts;
    expect(sent!.headers.authorization).toBe(`Bearer ${UPLOAD_KEY}`);
    expect(sent!.headers.cookie).toBeUndefined();
    expect(sent!.keys).toEqual(['deleteToken', 'expiresInDays', 'html', 'id', 'title']);
    expect(made.body.share.url).toBe(`${own.origin}/a/${made.body.share.shareId}`);
    expect(JSON.stringify(made.body)).not.toContain(UPLOAD_KEY);
    const stored = [
      await s.rows('artifact_page_shares'),
      await s.rows('run_protocol_log'),
      await s.rows('run_events'),
    ].join('\n');
    expect(stored).not.toContain(UPLOAD_KEY);

    await client.send('delete', sharePath(id)).expect(204);
    expect(own.fake.deletes[0]!.authorization).not.toContain(UPLOAD_KEY);
    expect(own.fake.shares.size).toBe(0);
  });

  it('uploads to the hosted service with no key, and refuses 7 days there', async () => {
    const id = await s.publish('html', HTML);
    const client = s.client();

    const refused = await client
      .send('post', sharePath(id), { expiresInDays: 7, passcode: false })
      .expect(400);
    expect(refused.body.error).toBe(
      'Links from Spark’s shared service last 1 day. Connect your own Cloudflare account for 7 days.',
    );
    expect(s.fake.posts).toHaveLength(0);
    expect(await s.states()).toEqual([]);

    await client.send('post', sharePath(id), { expiresInDays: 1, passcode: false }).expect(201);
    expect(s.fake.posts[0]!.headers.authorization).toBeUndefined();
    expect(own.fake.posts).toHaveLength(0);
  });

  it('falls back to the hosted service while sharing through the own one is off', async () => {
    await s.connectOwn(own);
    await s.t.db.query('UPDATE cloudflare_connections SET share_artifacts = false');
    const id = await s.publish('html', HTML);

    await s.client().send('post', sharePath(id), { expiresInDays: 1, passcode: false }).expect(201);

    expect(own.fake.posts).toHaveLength(0);
    expect(s.fake.posts[0]!.headers.authorization).toBeUndefined();
  });

  it('uploads nothing when the upload key is missing from the keychain', async () => {
    await s.connectOwn(own);
    await s.secrets.delete(CLOUDFLARE_UPLOAD_KEY_SECRET);
    const id = await s.publish('html', HTML);

    const refused = await s
      .client()
      .send('post', sharePath(id), { expiresInDays: 7, passcode: false })
      .expect(409);

    expect(refused.body.error).toMatch(/upload key/);
    expect(own.fake.posts).toHaveLength(0);
    expect(s.fake.posts).toHaveLength(0);
    expect(await s.states()).toEqual([]);
  });

  it('takes its try down when the own service refuses the key', async () => {
    await s.connectOwn(own);
    own.fake.uploadKey = `${UPLOAD_KEY}-rotated`;
    const id = await s.publish('html', HTML);

    const failed = await s
      .client()
      .send('post', sharePath(id), { expiresInDays: 7, passcode: false })
      .expect(502);

    expect(failed.body.error).toMatch(/401/);
    expect(JSON.stringify(failed.body)).not.toContain(UPLOAD_KEY);
    expect(own.fake.shares.size).toBe(0);
    expect(await s.states()).toEqual([]);
  });
});
