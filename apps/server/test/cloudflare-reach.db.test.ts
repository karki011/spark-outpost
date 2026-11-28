import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cloudflareReachSchema, type CloudflareReach } from '@spark-outpost/contracts';
import { createApp } from '../src/api/app.ts';
import {
  REACH_NOT_CONNECTED,
  REACH_NO_TUNNEL_PROGRAM,
  REACH_RECORD_TAKEN,
  ZERO_TRUST_URL,
  reachNoDomain,
} from '../src/cloudflare/reach-problems.ts';
import type { TunnelRunner } from '../src/cloudflare/tunnel-runner.ts';
import { saveRemoteHostname } from '../src/remote/store.ts';
import {
  CLOUDFLARE_TUNNEL_TOKEN_SECRET,
  memorySecretStore,
  type SecretStore,
} from '../src/setup/secrets.ts';
import { localClient, testAppOptions } from './app-support.ts';
import {
  FAKE_CLOUDFLARE_CLIENT,
  FAKE_TUNNEL_TOKEN,
  FakeCloudflare,
  REACH_SCOPES_GRANTED,
} from './fake-cloudflare.ts';
import { pairDevice, remoteClient, turnRemoteOn } from './remote-support.ts';
import {
  comeBack,
  failed,
  FakeRunner,
  REACH,
  settled,
  setUp,
  states,
  WANTED,
} from './cloudflare-reach-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let cloudflare: FakeCloudflare;
let secrets: SecretStore;
let runner: FakeRunner;

beforeEach(async () => {
  t = await createTestDb();
  cloudflare = new FakeCloudflare();
  cloudflare.scopes = REACH_SCOPES_GRANTED;
  secrets = memorySecretStore();
  runner = new FakeRunner();
});

afterEach(async () => {
  await t.cleanup();
});

function app(tunnelRunner: TunnelRunner | null = runner) {
  return createApp({
    ...testAppOptions(t, { secrets }),
    cloudflareClient: FAKE_CLOUDFLARE_CLIENT,
    cloudflareSetup: { fetch: cloudflare.fetch },
    tunnelRunner,
  });
}

describe('reaching this computer through Cloudflare', { timeout: 30_000 }, () => {
  it('is not offered without Cloudflare’s tunnel program', async () => {
    const client = localClient(app(null));
    expect((await client.get(REACH).expect(200)).body).toMatchObject({
      available: false,
      tunnel: 'off',
    });
    const refused = await client.send('post', REACH, WANTED).expect(400);
    expect(refused.body.error).toBe(REACH_NO_TUNNEL_PROGRAM);
  });

  it('finds the domain on a later page of a large account', async () => {
    cloudflare.zones = [
      ...Array.from({ length: 50 }, (_, index) => ({
        id: `other${index}`,
        name: `other${index}.test`,
      })),
      ...cloudflare.zones,
    ];
    const { reach } = await setUp(localClient(app()));
    expect(reach.status).toBe('done');
  });

  it('never runs a key that belongs to another tunnel', async () => {
    const client = localClient(app());
    await setUp(client);
    await client.send('delete', REACH).expect(200);
    await t.db.query(
      `INSERT INTO cloudflare_reach (workspace_id, hostname, account_id, zone_id, tunnel_id)
       VALUES ($1, 'spark.example.com', 'acct', 'zone1', 'tun1')`,
      [t.workspaceId],
    );
    await secrets.set(
      CLOUDFLARE_TUNNEL_TOKEN_SECRET,
      JSON.stringify([{ tunnel: 'older', token: 'older-token-0123456789' }]),
    );
    await saveRemoteHostname(t.db, t.workspaceId, 'spark.example.com', 'custom');
    runner.started.length = 0;
    expect((await client.get(REACH).expect(200)).body.tunnel).toBe('off');
    expect(runner.started).toEqual([]);
  });

  it('stops when the account has no domain for the address', async () => {
    cloudflare.zones = [{ id: 'zone9', name: 'other.org' }];
    const { reach } = await setUp(localClient(app()));
    expect(failed(reach)).toMatchObject({
      id: 'domain',
      problem: reachNoDomain('spark.example.com'),
      fix: null,
    });
    expect(cloudflare.reach.cname).toBeNull();
    expect(runner.started).toEqual([]);
  });

  it('never replaces a DNS record that is not its own', async () => {
    cloudflare.dnsRecords = [{ type: 'A', content: '192.0.2.1' }];
    const { reach } = await setUp(localClient(app()));
    expect(failed(reach)).toMatchObject({ id: 'address', problem: REACH_RECORD_TAKEN });
    expect(cloudflare.reach.cname).toBeNull();
    expect(states(reach)).toMatchObject({ tunnel: 'done', signInPage: 'todo' });
  });

  it('points at Zero Trust when the sign-in page can’t be added, and resumes without a sign-in', async () => {
    cloudflare.accessOn = false;
    const client = localClient(app());
    const { reach } = await setUp(client);
    expect(failed(reach)).toMatchObject({
      id: 'signInPage',
      fix: 'cloudflare',
      fixUrl: ZERO_TRUST_URL,
    });
    expect(runner.started).toEqual([]);

    cloudflare.accessOn = true;
    const again = (await client.send('post', `${REACH}/resume`).expect(200))
      .body as CloudflareReach;
    expect(again.authorizeUrl).toBeNull();
    expect((await settled(client)).status).toBe('done');
  });

  it('stops when a later page of domains can’t be read', async () => {
    cloudflare.zones = [
      ...Array.from({ length: 50 }, (_, index) => ({
        id: `other${index}`,
        name: `other${index}.test`,
      })),
      { id: '', name: 'example.com' },
    ];
    const { reach } = await setUp(localClient(app()));
    expect(failed(reach)).toMatchObject({ id: 'domain', fix: 'retry' });
  });

  it('leaves the tunnel stopped when a removal overlaps the background check', async () => {
    const client = localClient(app());
    await setUp(client);
    await saveRemoteHostname(t.db, t.workspaceId, 'spark.example.com', 'custom');
    runner.stop();
    const read = secrets.get.bind(secrets);
    let release = () => undefined as void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const asked = new Promise<void>((resolve) => {
      secrets.get = async (name) => {
        const value = await read(name);
        resolve();
        await held;
        return value;
      };
    });
    const checking = client.get(REACH).expect(200);
    const checked = checking.then(() => undefined);
    await asked;
    const removing = client.send('delete', REACH).expect(200);
    const removed = removing.then((response) => response.body as CloudflareReach);
    await new Promise((resolve) => setTimeout(resolve, 50));
    release();
    await checked;
    expect((await removed).tunnel).toBe('off');
    secrets.get = read;
    expect(runner.current).toBe('off');
    expect(await secrets.get(CLOUDFLARE_TUNNEL_TOKEN_SECRET)).toBeNull();
  });

  it('keeps the earlier tunnel’s key until the saved address switches', async () => {
    const client = localClient(app());
    await setUp(client);
    await saveRemoteHostname(t.db, t.workspaceId, 'spark.example.com', 'custom');
    await secrets.set(
      CLOUDFLARE_TUNNEL_TOKEN_SECRET,
      JSON.stringify([
        { tunnel: 'newer', token: 'newer-token-0123456789' },
        { tunnel: 'tun1', token: FAKE_TUNNEL_TOKEN },
      ]),
    );
    runner.stop();
    runner.started.length = 0;
    expect((await client.get(REACH).expect(200)).body.tunnel).toBe('running');
    expect(runner.started).toEqual([FAKE_TUNNEL_TOKEN]);
  });

  it('refuses a new set-up while a removal is still finishing', async () => {
    let release = () => undefined as void;
    cloudflare.tokenHeld = new Promise<void>((resolve) => (release = resolve));
    const asked = new Promise<void>((resolve) => (cloudflare.tokenAsked = resolve));
    const client = localClient(app());
    const started = cloudflareReachSchema.parse(
      (await client.send('post', REACH, WANTED).expect(200)).body,
    );
    await comeBack(started);
    await asked;
    const removing = client.send('delete', REACH).expect(200);
    const again = client.send('delete', REACH).expect(200);
    const removed = Promise.all([removing, again]).then(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await client.send('post', REACH, WANTED).expect(400);
    release();
    await removed;
    expect((await t.db.query('SELECT 1 FROM cloudflare_reach')).rowCount).toBe(0);
    expect(await secrets.get(CLOUDFLARE_TUNNEL_TOKEN_SECRET)).toBeNull();
  });

  it('keeps both keys when the saved address can’t be switched', async () => {
    const client = localClient(app());
    await setUp(client);
    await t.db.query(`UPDATE cloudflare_reach SET tunnel_id = 'older'`);
    const older = { tunnel: 'older', token: 'older-token-0123456789' };
    await secrets.set(CLOUDFLARE_TUNNEL_TOKEN_SECRET, JSON.stringify([older]));
    const query = t.db.query.bind(t.db);
    t.db.query = ((text: string, values?: unknown[]) =>
      text.includes('INSERT INTO cloudflare_reach')
        ? Promise.reject(new Error('write failed'))
        : query(text, values)) as typeof t.db.query;
    try {
      const { reach } = await setUp(client);
      expect(failed(reach)?.id).toBe('start');
    } finally {
      t.db.query = query;
    }
    expect(JSON.parse((await secrets.get(CLOUDFLARE_TUNNEL_TOKEN_SECRET)) ?? '[]')).toEqual([
      { tunnel: 'tun1', token: FAKE_TUNNEL_TOKEN },
      older,
    ]);
    const { rows } = await t.db.query('SELECT tunnel_id FROM cloudflare_reach');
    expect(rows).toEqual([{ tunnel_id: 'older' }]);
  });

  it('starts nothing when a removal finishes while a new set-up is still clearing the old sign-in', async () => {
    cloudflare.accessOn = false;
    const client = localClient(app());
    await setUp(client);
    let release = () => undefined as void;
    cloudflare.revokeHeld = new Promise<void>((resolve) => (release = resolve));
    const asked = new Promise<void>((resolve) => (cloudflare.revokeAsked = resolve));
    const starting = client.send('post', REACH, WANTED);
    const refused = starting.then((response) => response.status);
    await asked;
    await client.send('delete', REACH).expect(200);
    release();
    expect(await refused).toBe(400);
    expect((await client.get(REACH).expect(200)).body).toMatchObject({
      status: 'idle',
      authorizeUrl: null,
    });
  });

  it('says so when the tunnel does not connect', async () => {
    runner.connects = false;
    const { reach } = await setUp(localClient(app()));
    expect(failed(reach)).toMatchObject({
      id: 'start',
      problem: REACH_NOT_CONNECTED,
      fix: 'retry',
    });
  });

  it('keeps the tunnel only while Remote control uses its address', async () => {
    const client = localClient(app());
    await setUp(client);
    await saveRemoteHostname(t.db, t.workspaceId, 'spark.example.com', 'custom');
    expect((await client.get(REACH).expect(200)).body).toMatchObject({
      tunnel: 'running',
      connected: 'spark.example.com',
    });

    const removed = (await client.send('delete', REACH).expect(200)).body as CloudflareReach;
    expect(removed).toMatchObject({
      status: 'idle',
      tunnel: 'off',
      hostname: null,
      connected: null,
    });
    expect(await secrets.get(CLOUDFLARE_TUNNEL_TOKEN_SECRET)).toBeNull();
    expect((await t.db.query('SELECT 1 FROM cloudflare_reach')).rowCount).toBe(0);
  });

  it('leaves no key behind when it is removed while the tunnel is being made', async () => {
    let release = () => undefined as void;
    cloudflare.tokenHeld = new Promise<void>((resolve) => (release = resolve));
    const asked = new Promise<void>((resolve) => (cloudflare.tokenAsked = resolve));
    const client = localClient(app());
    const started = cloudflareReachSchema.parse(
      (await client.send('post', REACH, WANTED).expect(200)).body,
    );
    await comeBack(started);
    await asked;

    const removing = client.send('delete', REACH).expect(200);
    const sent = removing.then((response) => response.body as CloudflareReach);
    await new Promise((resolve) => setTimeout(resolve, 50));
    release();
    expect((await sent).connected).toBeNull();
    expect(await secrets.get(CLOUDFLARE_TUNNEL_TOKEN_SECRET)).toBeNull();
    expect((await t.db.query('SELECT 1 FROM cloudflare_reach')).rowCount).toBe(0);
    expect(runner.started).toEqual([]);
  });

  it('is never reachable from a paired device', async () => {
    const built = app();
    await turnRemoteOn(built);
    const remote = remoteClient(built, (await pairDevice(built)).cookie);
    await remote.get(REACH).expect(403);
    await remote.send('post', REACH, WANTED).expect(403);
    await remote.send('delete', REACH).expect(403);
  });
});
