import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CLOUDFLARE_DEPLOY_URL,
  CLOUDFLARE_PROBLEMS,
  cloudflareConnectionSchema,
} from '@spark-outpost/contracts';
import { CLOUDFLARE_UPLOAD_KEY_SECRET, memorySecretStore } from '../src/setup/secrets.ts';
import {
  HTML,
  ShareHarness,
  UPLOAD_KEY,
  sharePath,
  startFakeWorker,
  type FakeWorker,
} from './artifact-share-support.ts';
import { pairDevice, remoteClient, setSwitches, turnRemoteOn } from './remote-support.ts';
import { postReset, recordingStore } from './reset-support.ts';

let s: ShareHarness;
let own: FakeWorker;

beforeEach(async () => {
  s = await ShareHarness.create();
  own = await startFakeWorker();
  own.fake.uploadKey = UPLOAD_KEY;
});

afterEach(async () => {
  await own.close();
  await s.close();
});

const connect = (client: ReturnType<ShareHarness['client']>, body: object) =>
  client.send('put', '/api/cloudflare', body);

async function everythingStored(): Promise<string> {
  const tables = ['cloudflare_connections', 'remote_audit', 'run_protocol_log', 'run_events'];
  return (await Promise.all(tables.map((table) => s.rows(table)))).join('\n');
}

describe('the Cloudflare connection', { timeout: 30_000 }, () => {
  it('reads as not connected until a share service is connected', async () => {
    const answer = await s.client().get('/api/cloudflare').expect(200);
    expect(cloudflareConnectionSchema.parse(answer.body)).toEqual({
      connected: false,
      origin: null,
      host: null,
      shareArtifacts: true,
      checkedAt: null,
      problem: null,
      sharedNow: 0,
      deployUrl: CLOUDFLARE_DEPLOY_URL,
    });
  });

  it('connects after asking the service with the key, and keeps the key only in the keychain', async () => {
    const client = s.client();
    const answer = await connect(client, {
      address: `${own.origin}/`,
      uploadKey: UPLOAD_KEY,
    }).expect(200);

    expect(cloudflareConnectionSchema.parse(answer.body)).toMatchObject({
      connected: true,
      origin: own.origin,
      host: new URL(own.origin).host,
      shareArtifacts: true,
      problem: null,
      sharedNow: 0,
    });
    expect(answer.body.checkedAt).not.toBeNull();
    expect(own.fake.serviceCalls).toHaveLength(1);
    const [headers] = own.fake.serviceCalls;
    expect(headers!.authorization).toBe(`Bearer ${UPLOAD_KEY}`);
    expect(headers!.cookie).toBeUndefined();
    expect(headers!['content-type']).toBeUndefined();
    expect(await s.secrets.get(CLOUDFLARE_UPLOAD_KEY_SECRET)).toBe(UPLOAD_KEY);
    const read = await client.get('/api/cloudflare').expect(200);
    expect(JSON.stringify([answer.body, read.body])).not.toContain(UPLOAD_KEY);
    expect(await everythingStored()).not.toContain(UPLOAD_KEY);
  });

  it('refuses a bad address or key shape before any request', async () => {
    const client = s.client();
    for (const address of ['http://example.com', `${own.origin}/path`, 'not an address']) {
      const refused = await connect(client, { address, uploadKey: UPLOAD_KEY }).expect(400);
      expect(refused.body).toEqual({ error: CLOUDFLARE_PROBLEMS.address, problem: 'address' });
    }
    const short = await connect(client, { address: own.origin, uploadKey: 'short' }).expect(400);
    expect(short.body).toEqual({ error: CLOUDFLARE_PROBLEMS.key, problem: 'key' });
    expect(own.fake.serviceCalls).toHaveLength(0);
    expect(await s.rows('cloudflare_connections')).toBe('[]');
    expect(await s.secrets.get(CLOUDFLARE_UPLOAD_KEY_SECRET)).toBeNull();
  });

  it('refuses a service that is unreachable, not a share service, keyed otherwise or open', async () => {
    const client = s.client();
    const gone = await startFakeWorker();
    await gone.close();
    const body = (origin: string) => ({ address: origin, uploadKey: UPLOAD_KEY });

    const unreachable = await connect(client, body(gone.origin)).expect(502);
    expect(unreachable.body.problem).toBe('unreachable');

    own.fake.info = { hello: 'world' };
    const other = await connect(client, body(own.origin)).expect(502);
    expect(other.body).toEqual({ error: CLOUDFLARE_PROBLEMS.notService, problem: 'notService' });
    own.fake.info = null;

    own.fake.uploadKey = `${UPLOAD_KEY}-other`;
    const refused = await connect(client, body(own.origin)).expect(400);
    expect(refused.body).toEqual({ error: CLOUDFLARE_PROBLEMS.refused, problem: 'refused' });

    own.fake.uploadKey = null;
    const open = await connect(client, body(own.origin)).expect(400);
    expect(open.body).toEqual({ error: CLOUDFLARE_PROBLEMS.open, problem: 'open' });

    expect(await s.rows('cloudflare_connections')).toBe('[]');
    expect(await s.secrets.get(CLOUDFLARE_UPLOAD_KEY_SECRET)).toBeNull();
  });

  it('replaces the address and key when connected again', async () => {
    const client = s.client();
    await connect(client, { address: own.origin, uploadKey: UPLOAD_KEY }).expect(200);
    const next = await startFakeWorker();
    const nextKey = `${UPLOAD_KEY}_next`;
    next.fake.uploadKey = nextKey;
    try {
      const answer = await connect(client, { address: next.origin, uploadKey: nextKey });
      expect(answer.body.origin).toBe(next.origin);
      expect(await s.secrets.get(CLOUDFLARE_UPLOAD_KEY_SECRET)).toBe(nextKey);
      const { rows } = await s.t.db.query('SELECT origin FROM cloudflare_connections');
      expect(rows).toEqual([{ origin: next.origin }]);
    } finally {
      await next.close();
    }
  });

  it('turns sharing through it off and on', async () => {
    const client = s.client();
    await client.send('patch', '/api/cloudflare', { shareArtifacts: false }).expect(400);
    await connect(client, { address: own.origin, uploadKey: UPLOAD_KEY }).expect(200);

    const off = await client.send('patch', '/api/cloudflare', { shareArtifacts: false });
    expect(off.body).toMatchObject({ connected: true, shareArtifacts: false });
    const id = await s.publish('html', HTML);
    expect((await client.get(sharePath(id)).expect(200)).body).toMatchObject({
      service: 'hosted',
      days: [1],
    });

    const on = await client.send('patch', '/api/cloudflare', { shareArtifacts: true });
    expect(on.body.shareArtifacts).toBe(true);
    expect((await client.get(sharePath(id)).expect(200)).body.service).toBe('own');
  });

  it('checks the service again with the stored key and records what it found', async () => {
    const client = s.client();
    await client.send('post', '/api/cloudflare/check').expect(400);
    await connect(client, { address: own.origin, uploadKey: UPLOAD_KEY }).expect(200);

    own.fake.uploadKey = `${UPLOAD_KEY}-rotated`;
    const refused = await client.send('post', '/api/cloudflare/check').expect(200);
    expect(refused.body).toMatchObject({ connected: true, problem: CLOUDFLARE_PROBLEMS.refused });
    expect((await client.get('/api/cloudflare')).body.problem).toBe(CLOUDFLARE_PROBLEMS.refused);

    own.fake.uploadKey = UPLOAD_KEY;
    const fine = await client.send('post', '/api/cloudflare/check').expect(200);
    expect(fine.body.problem).toBeNull();
    expect(Date.parse(fine.body.checkedAt)).toBeGreaterThanOrEqual(
      Date.parse(refused.body.checkedAt),
    );
    expect(own.fake.serviceCalls.at(-1)!.authorization).toBe(`Bearer ${UPLOAD_KEY}`);

    await s.secrets.delete(CLOUDFLARE_UPLOAD_KEY_SECRET);
    const lost = await client.send('post', '/api/cloudflare/check').expect(200);
    expect(lost.body.problem).toBe(CLOUDFLARE_PROBLEMS.key);
    expect(JSON.stringify([refused.body, fine.body, lost.body])).not.toContain(UPLOAD_KEY);
  });

  it('disconnects without taking shared pages down, and they can still be stopped', async () => {
    const client = s.client();
    await connect(client, { address: own.origin, uploadKey: UPLOAD_KEY }).expect(200);
    const id = await s.publish('html', HTML);
    const made = await client
      .send('post', sharePath(id), { expiresInDays: 7, passcode: false })
      .expect(201);
    expect((await client.get('/api/cloudflare')).body.sharedNow).toBe(1);

    await client.send('delete', '/api/cloudflare').expect(204);

    expect(await s.secrets.get(CLOUDFLARE_UPLOAD_KEY_SECRET)).toBeNull();
    expect(await s.rows('cloudflare_connections')).toBe('[]');
    expect((await client.get('/api/cloudflare')).body.connected).toBe(false);
    expect(own.fake.deletes).toEqual([]);
    expect(own.fake.shares.size).toBe(1);
    expect((await client.get(sharePath(id))).body.share).toEqual(made.body.share);

    await client.send('delete', sharePath(id)).expect(204);
    const token = own.fake.deletes[0]!.authorization;
    expect(token).toMatch(/^Bearer /);
    expect(token).not.toContain(UPLOAD_KEY);
    expect(own.fake.shares.size).toBe(0);
    expect(s.fake.deletes).toEqual([]);
    await client.send('delete', '/api/cloudflare').expect(204);
  });

  it('lets the sweep take down an orphan on the disconnected service without the upload key', async () => {
    const client = s.client();
    await connect(client, { address: own.origin, uploadKey: UPLOAD_KEY }).expect(200);
    const id = await s.publish('html', HTML);
    await client.send('post', sharePath(id), { expiresInDays: 7, passcode: false }).expect(201);
    await client.send('delete', '/api/cloudflare').expect(204);
    await s.t.db.query('DELETE FROM artifact_page_versions WHERE artifact_id = $1', [id]);

    await s.sweep();

    expect(own.fake.shares.size).toBe(0);
    expect(await s.rows('artifact_page_shares')).toBe('[]');
  });

  it('is refused on a paired device, whatever the switches say', async () => {
    const app = s.app();
    await turnRemoteOn(app);
    const phone = remoteClient(app, (await pairDevice(app)).cookie);
    await setSwitches(app, { connections: true, settings: true, artifacts: true });

    await phone.get('/api/cloudflare').expect(403);
    await phone
      .send('put', '/api/cloudflare', { address: own.origin, uploadKey: UPLOAD_KEY })
      .expect(403);
    await phone.send('patch', '/api/cloudflare', { shareArtifacts: false }).expect(403);
    await phone.send('post', '/api/cloudflare/check').expect(403);
    await phone.send('delete', '/api/cloudflare').expect(403);
    expect(own.fake.serviceCalls).toHaveLength(0);
  });

  it('loses its key and row on reset', async () => {
    await connect(s.client(), { address: own.origin, uploadKey: UPLOAD_KEY }).expect(200);
    const secrets = recordingStore(
      memorySecretStore({ [CLOUDFLARE_UPLOAD_KEY_SECRET]: UPLOAD_KEY }),
    );

    await postReset(s.t, secrets, { keepApiKeys: true }).expect(200);

    expect(secrets.deleted).toContain(CLOUDFLARE_UPLOAD_KEY_SECRET);
    expect(await secrets.get(CLOUDFLARE_UPLOAD_KEY_SECRET)).toBeNull();
    expect(await s.rows('cloudflare_connections')).toBe('[]');
  });
});
