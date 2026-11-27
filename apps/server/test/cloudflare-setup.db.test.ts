import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cloudflareSetupSchema, type CloudflareSetup } from '@spark-outpost/contracts';
import { createApp } from '../src/api/app.ts';
import {
  SETUP_NOT_ALLOWED,
  SETUP_NO_SUBDOMAIN,
  SETUP_R2_OFF,
  SETUP_UNAVAILABLE,
  SETUP_WORKER_EXISTS,
  SETUP_WRONG_STATE,
} from '../src/cloudflare/setup-problems.ts';
import {
  CLOUDFLARE_UPLOAD_KEY_SECRET,
  memorySecretStore,
  type SecretStore,
} from '../src/setup/secrets.ts';
import { localClient, testAppOptions } from './app-support.ts';
import {
  FAKE_ACCOUNT,
  FAKE_CLOUDFLARE_CLIENT,
  FAKE_ORIGIN,
  FakeCloudflare,
} from './fake-cloudflare.ts';
import { pairDevice, remoteClient, turnRemoteOn } from './remote-support.ts';
import { createTestDb, type TestDb } from './support.ts';

const WORKER = 'export default { fetch() { return new Response("share"); } };';
const SETUP = '/api/cloudflare/setup';

let t: TestDb;
let cloudflare: FakeCloudflare;
let secrets: SecretStore;

beforeEach(async () => {
  t = await createTestDb();
  cloudflare = new FakeCloudflare();
  secrets = memorySecretStore();
});

afterEach(async () => {
  await t.cleanup();
});

function app(client: typeof FAKE_CLOUDFLARE_CLIENT | null = FAKE_CLOUDFLARE_CLIENT) {
  return createApp({
    ...testAppOptions(t, { secrets }),
    cloudflareClient: client,
    cloudflareCheck: { fetch: cloudflare.fetch, timeoutMs: 1_000 },
    cloudflareSetup: {
      fetch: cloudflare.fetch,
      readWorker: () => Promise.resolve(WORKER),
      sleep: () => Promise.resolve(),
    },
  });
}

type Client = ReturnType<typeof localClient>;

async function settled(client: Client): Promise<CloudflareSetup> {
  for (let tries = 0; tries < 200; tries += 1) {
    const setup = cloudflareSetupSchema.parse((await client.get(SETUP).expect(200)).body);
    if (setup.status !== 'working' && setup.status !== 'waiting') return setup;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('The setup never settled.');
}

async function approve(client: Client, change: (url: URL) => void = () => undefined) {
  const started = cloudflareSetupSchema.parse((await client.send('post', SETUP).expect(200)).body);
  const authorize = new URL(started.authorizeUrl!);
  const back = new URL(authorize.searchParams.get('redirect_uri')!);
  back.searchParams.set('code', 'code-from-cloudflare');
  back.searchParams.set('state', authorize.searchParams.get('state')!);
  change(back);
  await fetch(back);
  return { started, authorize, setup: await settled(client) };
}

const states = (setup: CloudflareSetup) =>
  Object.fromEntries(setup.steps.map((step) => [step.id, step.state]));
const failed = (setup: CloudflareSetup) => setup.steps.find((step) => step.state === 'failed');

describe('setting up Cloudflare with one sign-in', { timeout: 30_000 }, () => {
  it('is not offered without a Cloudflare app and the share service’s code', async () => {
    const client = localClient(app(null));
    const setup = (await client.get(SETUP).expect(200)).body;
    expect(setup).toMatchObject({ available: false, status: 'idle', authorizeUrl: null });
    const refused = await client.send('post', SETUP).expect(400);
    expect(refused.body.error).toBe(SETUP_UNAVAILABLE);
  });

  it('asks only for the permissions sharing needs, on a loopback address', async () => {
    const client = localClient(app());
    const started = (await client.send('post', SETUP).expect(200)).body as CloudflareSetup;
    const authorize = new URL(started.authorizeUrl!);
    expect(started.status).toBe('waiting');
    expect(started.permissions.map((one) => one.state)).toEqual(['needed', 'needed', 'needed']);
    expect(authorize.origin + authorize.pathname).toBe('https://dash.cloudflare.test/oauth2/auth');
    expect(authorize.searchParams.get('scope')).toBe(
      'account-settings.read workers-r2.write workers-scripts.admin',
    );
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorize.searchParams.get('redirect_uri')).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/oauth\/callback$/,
    );
    await client.send('delete', SETUP).expect(200);
  });

  it('creates the bucket and worker, connects, and keeps no Cloudflare sign-in', async () => {
    cloudflare.answersAfter = 2;
    const client = localClient(app());
    const { setup } = await approve(client);

    expect(setup.status).toBe('done');
    expect(setup.account).toBe('Hazel’s account');
    expect(setup.permissions.map((one) => one.state)).toEqual(['allowed', 'allowed', 'allowed']);
    expect(states(setup)).toEqual({
      signIn: 'done',
      bucket: 'done',
      worker: 'done',
      connect: 'done',
    });
    expect(cloudflare.uploadedModule).toBe(WORKER);
    expect(cloudflare.uploadedKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await secrets.get(CLOUDFLARE_UPLOAD_KEY_SECRET)).toBe(cloudflare.uploadedKey);
    expect(cloudflare.revoked).toEqual(['token-1-0123456789']);

    const connection = (await client.get('/api/cloudflare').expect(200)).body;
    expect(connection).toMatchObject({ connected: true, origin: FAKE_ORIGIN });
    const stored = JSON.stringify([
      setup,
      connection,
      (await t.db.query('SELECT * FROM cloudflare_connections')).rows,
    ]);
    expect(stored).not.toContain(cloudflare.uploadedKey!);
    expect(stored).not.toContain('token-1');
  });

  it('names a permission Cloudflare did not grant and asks to allow it', async () => {
    cloudflare.scopes = 'account-settings.read workers-scripts.admin';
    const client = localClient(app());
    const { setup } = await approve(client);

    expect(setup.status).toBe('stopped');
    expect(setup.permissions).toEqual([
      { id: 'account', state: 'allowed' },
      { id: 'storage', state: 'missing' },
      { id: 'workers', state: 'allowed' },
    ]);
    expect(failed(setup)).toMatchObject({
      id: 'bucket',
      problem: SETUP_NOT_ALLOWED.storage,
      fix: 'allow',
    });
    expect(cloudflare.calls).not.toContain(`POST /accounts/${FAKE_ACCOUNT}/r2/buckets`);

    cloudflare.scopes = 'account-settings.read workers-r2.write workers-scripts.admin';
    expect((await approve(client)).setup.status).toBe('done');
  });

  it('stops at storage that is turned off, keeps what is done and resumes without a sign-in', async () => {
    cloudflare.r2Enabled = false;
    const client = localClient(app());
    const { setup } = await approve(client);

    expect(failed(setup)).toEqual({
      id: 'bucket',
      state: 'failed',
      problem: SETUP_R2_OFF,
      fix: 'cloudflare',
      fixUrl: `https://dash.cloudflare.com/${FAKE_ACCOUNT}/r2/overview`,
    });
    expect(states(setup)).toMatchObject({ signIn: 'done', worker: 'todo' });

    cloudflare.r2Enabled = true;
    const again = (await client.send('post', SETUP).expect(200)).body as CloudflareSetup;
    expect(again.authorizeUrl).toBeNull();
    expect((await settled(client)).status).toBe('done');
    expect(cloudflare.revoked).toEqual(['token-1-0123456789']);
  });

  it('asks to allow again when Cloudflare refuses the worker', async () => {
    cloudflare.workersAllowed = false;
    const client = localClient(app());
    const { setup } = await approve(client);

    expect(failed(setup)).toMatchObject({
      id: 'worker',
      problem: SETUP_NOT_ALLOWED.workers,
      fix: 'allow',
    });
    expect(states(setup)).toMatchObject({ bucket: 'done', connect: 'todo' });
    const again = (await client.send('post', SETUP).expect(200)).body as CloudflareSetup;
    expect(again.status).toBe('waiting');
    expect(again.authorizeUrl).not.toBeNull();
    expect(states(again)).toMatchObject({ bucket: 'done', worker: 'todo' });
    await client.send('delete', SETUP).expect(200);
  });

  it('never replaces a worker that is already in the account', async () => {
    cloudflare.scriptExists = true;
    const client = localClient(app());
    const { setup } = await approve(client);

    expect(failed(setup)).toMatchObject({ id: 'worker', problem: SETUP_WORKER_EXISTS, fix: null });
    expect(cloudflare.uploadedKey).toBeNull();
    expect((await client.get('/api/cloudflare').expect(200)).body.connected).toBe(false);
  });

  it('finishes with the same key when the answer to the upload was lost', async () => {
    cloudflare.loseUploadAnswer = true;
    const client = localClient(app());
    const { setup } = await approve(client);
    expect(failed(setup)).toMatchObject({ id: 'worker', fix: 'retry' });
    const key = cloudflare.uploadedKey;

    await client.send('post', SETUP).expect(200);
    expect((await settled(client)).status).toBe('done');
    expect(cloudflare.uploadedKey).toBe(key);
    expect(await secrets.get(CLOUDFLARE_UPLOAD_KEY_SECRET)).toBe(key);
  });

  it('connects nothing when the set-up is cancelled while the service is being asked', async () => {
    const client = localClient(app());
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    let asked = () => {};
    const asking = new Promise<void>((resolve) => (asked = resolve));
    cloudflare.onServiceAsked = () => {
      asked();
      return held;
    };
    const started = (await client.send('post', SETUP).expect(200)).body as CloudflareSetup;
    const authorize = new URL(started.authorizeUrl!);
    const back = new URL(authorize.searchParams.get('redirect_uri')!);
    back.searchParams.set('code', 'code-from-cloudflare');
    back.searchParams.set('state', authorize.searchParams.get('state')!);
    await fetch(back);
    await asking;

    expect((await client.send('delete', SETUP).expect(200)).body.status).toBe('idle');
    release();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await secrets.get(CLOUDFLARE_UPLOAD_KEY_SECRET)).toBeNull();
    expect((await client.get('/api/cloudflare').expect(200)).body.connected).toBe(false);
  });

  it('puts the keychain back when the set-up is cancelled while the key is being saved', async () => {
    const store = memorySecretStore();
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    let saving = () => {};
    const reached = new Promise<void>((resolve) => (saving = resolve));
    secrets = {
      ...store,
      set: async (name, value) => {
        saving();
        await held;
        await store.set(name, value);
      },
    };
    const client = localClient(app());
    const started = (await client.send('post', SETUP).expect(200)).body as CloudflareSetup;
    const authorize = new URL(started.authorizeUrl!);
    const back = new URL(authorize.searchParams.get('redirect_uri')!);
    back.searchParams.set('code', 'code-from-cloudflare');
    back.searchParams.set('state', authorize.searchParams.get('state')!);
    await fetch(back);
    await reached;

    const cancelling = client
      .send('delete', SETUP)
      .expect(200)
      .then(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 100));
    release();
    await cancelling;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await store.get(CLOUDFLARE_UPLOAD_KEY_SECRET)).toBeNull();
    expect((await client.get('/api/cloudflare').expect(200)).body.connected).toBe(false);
  });

  it('revokes and never uses a token that arrives after the set-up was cancelled', async () => {
    const client = localClient(app());
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    let asked = () => {};
    const exchanging = new Promise<void>((resolve) => (asked = resolve));
    cloudflare.onTokenAsked = () => {
      asked();
      return held;
    };
    const started = (await client.send('post', SETUP).expect(200)).body as CloudflareSetup;
    const authorize = new URL(started.authorizeUrl!);
    const back = new URL(authorize.searchParams.get('redirect_uri')!);
    back.searchParams.set('code', 'code-from-cloudflare');
    back.searchParams.set('state', authorize.searchParams.get('state')!);
    await fetch(back);
    await exchanging;

    await client.send('delete', SETUP).expect(200);
    release();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(cloudflare.revoked).toEqual(['token-1-0123456789']);
    expect(cloudflare.calls).toEqual([]);
    expect((await client.get(SETUP).expect(200)).body.status).toBe('idle');
  });

  it('revokes the sign-in when the account can’t be read', async () => {
    cloudflare.scopes = 'workers-r2.write workers-scripts.admin';
    const { setup } = await approve(localClient(app()));
    expect(failed(setup)).toMatchObject({ id: 'signIn', fix: 'allow' });
    expect(cloudflare.revoked).toEqual(['token-1-0123456789']);
  });

  it('points at Cloudflare when the account has no workers.dev address', async () => {
    cloudflare.subdomain = null;
    const { setup } = await approve(localClient(app()));
    expect(failed(setup)).toMatchObject({
      id: 'worker',
      problem: SETUP_NO_SUBDOMAIN,
      fix: 'cloudflare',
      fixUrl: `https://dash.cloudflare.com/${FAKE_ACCOUNT}/workers-and-pages`,
    });
  });

  it('refuses an answer whose state is not the one it sent', async () => {
    const client = localClient(app());
    const { setup } = await approve(client, (back) => back.searchParams.set('state', 'other'));
    expect(failed(setup)).toMatchObject({ id: 'signIn', problem: SETUP_WRONG_STATE, fix: 'allow' });
    expect(cloudflare.calls).toEqual([]);
  });

  it('cancel revokes the sign-in and starts over', async () => {
    cloudflare.r2Enabled = false;
    const client = localClient(app());
    await approve(client);
    const idle = (await client.send('delete', SETUP).expect(200)).body as CloudflareSetup;
    expect(idle.status).toBe('idle');
    expect(states(idle)).toMatchObject({ signIn: 'todo', bucket: 'todo' });
    expect(cloudflare.revoked).toEqual(['token-1-0123456789']);
  });

  it('is never reachable from a paired device', async () => {
    const built = app();
    await turnRemoteOn(built);
    const remote = remoteClient(built, (await pairDevice(built)).cookie);
    await remote.get(SETUP).expect(403);
    await remote.send('post', SETUP).expect(403);
    await remote.send('delete', SETUP).expect(403);
  });
});
