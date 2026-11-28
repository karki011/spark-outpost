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
import type { TunnelRunner, TunnelState } from '../src/cloudflare/tunnel-runner.ts';
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
import { createTestDb, type TestDb } from './support.ts';

const REACH = '/api/cloudflare/reach';
const WANTED = { hostname: 'spark.example.com', email: 'owner@example.com' };

class FakeRunner implements TunnelRunner {
  connects = true;
  current: TunnelState = 'off';
  readonly started: string[] = [];
  state = () => this.current;
  start(token: string) {
    this.started.push(token);
    this.current = this.connects ? 'running' : 'stopped';
    return Promise.resolve(this.connects);
  }
  stop() {
    this.current = 'off';
  }
}

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

type Client = ReturnType<typeof localClient>;

async function settled(client: Client): Promise<CloudflareReach> {
  for (let tries = 0; tries < 200; tries += 1) {
    const reach = cloudflareReachSchema.parse((await client.get(REACH).expect(200)).body);
    if (reach.status !== 'working' && reach.status !== 'waiting') return reach;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('The set-up never settled.');
}

async function comeBack(started: CloudflareReach) {
  const authorize = new URL(started.authorizeUrl!);
  const back = new URL(authorize.searchParams.get('redirect_uri')!);
  back.searchParams.set('code', 'code-from-cloudflare');
  back.searchParams.set('state', authorize.searchParams.get('state')!);
  await fetch(back);
  return authorize;
}

async function setUp(client: Client) {
  const started = cloudflareReachSchema.parse(
    (await client.send('post', REACH, WANTED).expect(200)).body,
  );
  const authorize = await comeBack(started);
  return { authorize, reach: await settled(client) };
}

const states = (reach: CloudflareReach) =>
  Object.fromEntries(reach.steps.map((step) => [step.id, step.state]));
const failed = (reach: CloudflareReach) => reach.steps.find((step) => step.state === 'failed');

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

  it('asks only for the tunnel, DNS and sign-in page permissions', async () => {
    const client = localClient(app());
    const started = (await client.send('post', REACH, WANTED).expect(200)).body as CloudflareReach;
    const authorize = new URL(started.authorizeUrl!);
    expect(authorize.searchParams.get('scope')).toBe(REACH_SCOPES_GRANTED);
    expect(started.hostname).toBe('spark.example.com');
    await client.send('delete', `${REACH}/setup`).expect(200);
  });

  it('creates the tunnel, the address and the sign-in page, then runs the tunnel', async () => {
    const client = localClient(app());
    const { reach } = await setUp(client);

    expect(reach.status).toBe('done');
    expect(states(reach)).toEqual({
      signIn: 'done',
      domain: 'done',
      tunnel: 'done',
      address: 'done',
      signInPage: 'done',
      start: 'done',
    });
    expect(reach).toMatchObject({ tunnel: 'running', signedIn: false, hostname: WANTED.hostname });
    expect(cloudflare.reach.tunnelRoute).toEqual({
      ingress: [
        {
          hostname: 'spark.example.com',
          service: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+$/),
        },
        { service: 'http_status:404' },
      ],
    });
    expect(cloudflare.reach.cname).toEqual({
      type: 'CNAME',
      name: 'spark.example.com',
      content: 'tun1.cfargotunnel.com',
      proxied: true,
    });
    expect(cloudflare.reach.policy).toMatchObject({
      decision: 'allow',
      include: [{ email: { email: 'owner@example.com' } }],
    });
    expect(runner.started).toEqual([FAKE_TUNNEL_TOKEN]);
    expect(await secrets.get(CLOUDFLARE_TUNNEL_TOKEN_SECRET)).toBe(FAKE_TUNNEL_TOKEN);
    expect(cloudflare.revoked).toHaveLength(1);
    const stored = JSON.stringify([
      reach,
      (await t.db.query('SELECT * FROM cloudflare_reach')).rows,
    ]);
    expect(stored).not.toContain(FAKE_TUNNEL_TOKEN);
    expect(stored).not.toContain('token-1');
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

  it('adds the email rule on a retry when the sign-in page was made without it', async () => {
    cloudflare.policyFails = true;
    const client = localClient(app());
    const { reach } = await setUp(client);
    expect(failed(reach)?.id).toBe('signInPage');
    expect(cloudflare.accessApps).toHaveLength(1);

    cloudflare.policyFails = false;
    await client.send('post', `${REACH}/resume`).expect(200);
    expect((await settled(client)).status).toBe('done');
    expect(cloudflare.accessApps).toHaveLength(1);
    expect(cloudflare.reach.policy).toMatchObject({
      include: [{ email: { email: WANTED.email } }],
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
