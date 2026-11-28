import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CloudflareReach } from '@spark-outpost/contracts';
import { createApp } from '../src/api/app.ts';
import {
  CLOUDFLARE_TUNNEL_TOKEN_SECRET,
  memorySecretStore,
  type SecretStore,
} from '../src/setup/secrets.ts';
import { localClient, testAppOptions } from './app-support.ts';
import {
  failed,
  FakeRunner,
  REACH,
  settled,
  setUp,
  states,
  WANTED,
} from './cloudflare-reach-support.ts';
import {
  FAKE_CLOUDFLARE_CLIENT,
  FAKE_TUNNEL_TOKEN,
  FakeCloudflare,
  REACH_SCOPES_GRANTED,
} from './fake-cloudflare.ts';
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

function app() {
  return createApp({
    ...testAppOptions(t, { secrets }),
    cloudflareClient: FAKE_CLOUDFLARE_CLIENT,
    cloudflareSetup: { fetch: cloudflare.fetch },
    tunnelRunner: runner,
  });
}

describe('the sign-in page in front of a Cloudflare address', { timeout: 30_000 }, () => {
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
    expect(JSON.parse((await secrets.get(CLOUDFLARE_TUNNEL_TOKEN_SECRET)) ?? '[]')).toEqual([
      { tunnel: 'tun1', token: FAKE_TUNNEL_TOKEN },
    ]);
    expect(cloudflare.revoked).toHaveLength(1);
    const stored = JSON.stringify([
      reach,
      (await t.db.query('SELECT * FROM cloudflare_reach')).rows,
    ]);
    expect(stored).not.toContain(FAKE_TUNNEL_TOKEN);
    expect(stored).not.toContain('token-1');
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

  it('stops when the address already has a sign-in page for someone else', async () => {
    cloudflare.accessApps.push({ id: 'app1', domain: WANTED.hostname });
    cloudflare.reach.policy = {
      decision: 'allow',
      include: [{ email: { email: 'x@other.test' } }],
    };
    const client = localClient(app());
    const { reach } = await setUp(client);
    expect(failed(reach)).toMatchObject({ id: 'signInPage', fix: 'cloudflare' });
    expect(runner.started).toEqual([]);
    expect((await t.db.query('SELECT 1 FROM cloudflare_reach')).rowCount).toBe(0);
    expect(await secrets.get(CLOUDFLARE_TUNNEL_TOKEN_SECRET)).toBeNull();
  });

  it.each([
    ['excludes the email', { exclude: [{ email: { email: WANTED.email } }] }],
    ['also lets everyone in', { include: [{ email: { email: WANTED.email } }, { everyone: {} }] }],
    ['adds a requirement', { require: [{ geo: { country_code: 'US' } }] }],
  ])('stops when the existing sign-in page %s', async (_what, change) => {
    cloudflare.accessApps.push({ id: 'app1', domain: WANTED.hostname });
    cloudflare.reach.policy = {
      decision: 'allow',
      include: [{ email: { email: WANTED.email } }],
      ...change,
    };
    const { reach } = await setUp(localClient(app()));
    expect(failed(reach)).toMatchObject({ id: 'signInPage', fix: 'cloudflare' });
    expect(runner.started).toEqual([]);
  });

  it('stops when the sign-in page has more rules than Spark can read at once', async () => {
    cloudflare.accessApps.push({ id: 'app1', domain: WANTED.hostname });
    cloudflare.policies = Array.from({ length: 50 }, () => ({
      decision: 'allow',
      include: [{ email: { email: WANTED.email } }],
    }));
    const { reach } = await setUp(localClient(app()));
    expect(failed(reach)).toMatchObject({ id: 'signInPage', fix: 'cloudflare' });
  });

  it('stops when the existing sign-in page lets some paths skip sign-in', async () => {
    cloudflare.accessApps.push({
      id: 'app1',
      domain: WANTED.hostname,
      destinations: [{ type: 'public', overrides: [{ path: '/api', behavior: 'public' }] }],
    });
    cloudflare.reach.policy = { decision: 'allow', include: [{ email: { email: WANTED.email } }] };
    const { reach } = await setUp(localClient(app()));
    expect(failed(reach)).toMatchObject({ id: 'signInPage', fix: 'cloudflare' });
    expect(failed(reach)?.problem).toContain('skip sign-in');
    expect(runner.started).toEqual([]);
  });

  it.each([
    ['an exemption in a shape Spark does not know', { destinations: [{ overrides: 'all' }] }],
    ['destinations in a shape Spark does not know', { destinations: 'public' }],
  ])('stops when the existing sign-in page has %s', async (_what, extra) => {
    cloudflare.accessApps.push({ id: 'app1', domain: WANTED.hostname, ...extra });
    cloudflare.reach.policy = { decision: 'allow', include: [{ email: { email: WANTED.email } }] };
    const { reach } = await setUp(localClient(app()));
    expect(failed(reach)?.problem).toContain('skip sign-in');
  });

  it('adds no second sign-in page when the list of pages can’t be read', async () => {
    cloudflare.accessApps.push({ id: 7, domain: WANTED.hostname });
    const { reach } = await setUp(localClient(app()));
    expect(failed(reach)).toMatchObject({ id: 'signInPage', fix: 'retry' });
    expect(cloudflare.accessApps).toHaveLength(1);
  });
});
