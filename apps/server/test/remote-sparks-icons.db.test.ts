import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LOCAL_SPARK_ID,
  REMOTE_SPARK_ICON_MAX_BYTES,
  localSparkSchema,
  remoteSparkListSchema,
  remoteSparkSchema,
  sparkIconPath,
} from '@spark-outpost/contracts';
import { ICON_REFUSED } from '../src/remote-sparks/icon.ts';
import { memorySecretStore, type SecretStore } from '../src/setup/secrets.ts';
import { localClient } from './app-support.ts';
import { pairDevice, remoteClient, turnRemoteOn } from './remote-support.ts';
import {
  STUDIO,
  THIS_MAC,
  fakeDesktop,
  iconBody,
  pngBytes,
  sparkApp,
  type FakeDesktop,
} from './remote-sparks-support.ts';
import { postReset } from './reset-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let secrets: SecretStore;
let desktop: FakeDesktop;
let app: ReturnType<typeof sparkApp>;

beforeEach(async () => {
  t = await createTestDb();
  secrets = memorySecretStore();
  desktop = fakeDesktop();
  app = sparkApp(t, secrets, desktop);
});

afterEach(async () => {
  await t.cleanup();
});

const UNKNOWN = '0198c0de-0000-7000-8000-000000000001';
const FIRST = pngBytes(96, 96, 1);
const SECOND = pngBytes(96, 96, 2);
const VERSIONED = /\?v=[0-9a-f]{12}$/;

const local = () => localClient(app);

const list = async () =>
  remoteSparkListSchema.parse((await local().get('/api/remote-sparks').expect(200)).body);

async function added(address = `https://${STUDIO}`): Promise<string> {
  const response = await local()
    .send('post', '/api/remote-sparks', { address, name: 'Studio Mac' })
    .expect(201);
  return (response.body as { id: string }).id;
}

const iconCount = async (): Promise<number> => {
  const { rows } = await t.db.query<{ icons: number }>(
    `SELECT (SELECT count(*) FROM remote_sparks WHERE icon IS NOT NULL)::int +
            (SELECT count(*) FROM local_spark WHERE icon IS NOT NULL)::int AS icons`,
  );
  return rows[0]!.icons;
};

function refusedBodies(): object[] {
  const tooBig = Buffer.concat([pngBytes(96, 96), Buffer.alloc(REMOTE_SPARK_ICON_MAX_BYTES)]);
  return [
    { png: 'not base64!' },
    {},
    iconBody(tooBig.subarray(0, REMOTE_SPARK_ICON_MAX_BYTES + 1)),
    iconBody(tooBig),
    iconBody(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60)])),
    iconBody(pngBytes(1, 1)),
    iconBody(pngBytes(4000, 4000)),
  ];
}

async function expectIcon(path: string, bytes: Buffer): Promise<void> {
  const response = await local().get(path).buffer(true).expect(200);
  expect(Buffer.from(response.body as Buffer)).toEqual(bytes);
  expect(response.headers).toMatchObject({
    'content-type': 'image/png',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'",
    'cache-control': 'private, max-age=31536000, immutable',
  });
}

describe('a saved Spark’s icon', () => {
  it('is set, served, replaced under a new address and removed', async () => {
    const id = await added();
    expect((await list()).sparks[0]!.icon).toBeNull();
    await local().get(`/api/remote-sparks/${id}/icon`).expect(404);

    const set = remoteSparkSchema.parse(
      (await local().send('put', `/api/remote-sparks/${id}/icon`, iconBody(FIRST)).expect(200))
        .body,
    );
    expect(set.icon).toMatch(VERSIONED);
    expect(set.icon!.startsWith(sparkIconPath(id, ''))).toBe(true);
    expect((await list()).sparks[0]!.icon).toBe(set.icon);
    await expectIcon(set.icon!, FIRST);

    const replaced = remoteSparkSchema.parse(
      (await local().send('put', `/api/remote-sparks/${id}/icon`, iconBody(SECOND)).expect(200))
        .body,
    );
    expect(replaced.icon).toMatch(VERSIONED);
    expect(replaced.icon).not.toBe(set.icon);
    await expectIcon(replaced.icon!, SECOND);

    const renamed = await local()
      .send('patch', `/api/remote-sparks/${id}`, { name: 'Garage Mac' })
      .expect(200);
    expect(renamed.body.icon).toBe(replaced.icon);

    const removed = await local().send('delete', `/api/remote-sparks/${id}/icon`).expect(200);
    expect(removed.body).toMatchObject({ id, name: 'Garage Mac', icon: null });
    await local().get(`/api/remote-sparks/${id}/icon`).expect(404);
    expect((await list()).local.icon).toBeNull();
  });

  it('refuses anything but a small PNG, in one line', async () => {
    const id = await added();
    await local().send('put', `/api/remote-sparks/${id}/icon`, iconBody(FIRST)).expect(200);

    for (const [index, body] of refusedBodies().entries()) {
      const response = await local().send('put', `/api/remote-sparks/${id}/icon`, body).expect(400);
      expect([index, response.body]).toEqual([index, { error: ICON_REFUSED }]);
    }

    await expectIcon(`/api/remote-sparks/${id}/icon`, FIRST);
  });

  it('answers 404 for a Spark that is not saved and 400 for an id that is not one', async () => {
    await local().get(`/api/remote-sparks/${UNKNOWN}/icon`).expect(404);
    await local().send('put', `/api/remote-sparks/${UNKNOWN}/icon`, iconBody(FIRST)).expect(404);
    await local().send('delete', `/api/remote-sparks/${UNKNOWN}/icon`).expect(404);
    await local().get('/api/remote-sparks/nope/icon').expect(400);
    await local().send('put', '/api/remote-sparks/nope/icon', iconBody(FIRST)).expect(400);
    await local().send('patch', `/api/remote-sparks/${LOCAL_SPARK_ID}`, { name: 'x' }).expect(400);
    await local().send('delete', `/api/remote-sparks/${LOCAL_SPARK_ID}`).expect(400);
    expect(await iconCount()).toBe(0);
  });

  it('goes with its Spark when the Spark is removed', async () => {
    const id = await added();
    await local().send('put', `/api/remote-sparks/${id}/icon`, iconBody(FIRST)).expect(200);

    await local().send('delete', `/api/remote-sparks/${id}`).expect(204);

    expect(await iconCount()).toBe(0);
    await local().get(`/api/remote-sparks/${id}/icon`).expect(404);
  });
});

describe('this Mac in the list', () => {
  const unnamed = { name: null, defaultName: THIS_MAC, icon: null };

  it('has the computer’s name until the user gives it one, and takes it back when cleared', async () => {
    expect((await list()).local).toEqual(unnamed);

    const renamed = await local()
      .send('put', '/api/remote-sparks/local', { name: '  Work Mac ' })
      .expect(200);
    expect(localSparkSchema.parse(renamed.body)).toEqual({ ...unnamed, name: 'Work Mac' });
    expect((await list()).local).toEqual({ ...unnamed, name: 'Work Mac' });

    await local().send('put', '/api/remote-sparks/local', { name: '' }).expect(400);
    await local()
      .send('put', '/api/remote-sparks/local', { name: 'n'.repeat(61) })
      .expect(400);
    await local().send('put', '/api/remote-sparks/local', {}).expect(400);
    expect((await list()).local.name).toBe('Work Mac');

    const cleared = await local()
      .send('put', '/api/remote-sparks/local', { name: null })
      .expect(200);
    expect(cleared.body).toEqual(unnamed);
    expect((await list()).local).toEqual(unnamed);
  });

  it('keeps an icon of its own, apart from its name', async () => {
    await local().get('/api/remote-sparks/local/icon').expect(404);
    await local().send('put', '/api/remote-sparks/local', { name: 'Work Mac' }).expect(200);

    const set = localSparkSchema.parse(
      (await local().send('put', '/api/remote-sparks/local/icon', iconBody(FIRST)).expect(200))
        .body,
    );
    expect(set).toEqual({ name: 'Work Mac', defaultName: THIS_MAC, icon: set.icon });
    expect(set.icon).toMatch(VERSIONED);
    expect(set.icon!.startsWith(sparkIconPath(LOCAL_SPARK_ID, ''))).toBe(true);
    await expectIcon(set.icon!, FIRST);

    const replaced = await local()
      .send('put', '/api/remote-sparks/local/icon', iconBody(SECOND))
      .expect(200);
    expect(replaced.body.icon).not.toBe(set.icon);
    await expectIcon(replaced.body.icon as string, SECOND);

    await local().send('put', '/api/remote-sparks/local', { name: null }).expect(200);
    expect((await list()).local).toEqual({
      name: null,
      defaultName: THIS_MAC,
      icon: replaced.body.icon,
    });

    for (const body of refusedBodies()) {
      const response = await local().send('put', '/api/remote-sparks/local/icon', body).expect(400);
      expect(response.body).toEqual({ error: ICON_REFUSED });
    }
    await expectIcon('/api/remote-sparks/local/icon', SECOND);

    const removed = await local().send('delete', '/api/remote-sparks/local/icon').expect(200);
    expect(removed.body).toEqual({ name: null, defaultName: THIS_MAC, icon: null });
    await local().get('/api/remote-sparks/local/icon').expect(404);
    await local().send('delete', '/api/remote-sparks/local/icon').expect(200);
  });

  it('pairs under its custom name, and under the computer’s name once that is cleared', async () => {
    await local().send('put', '/api/remote-sparks/local', { name: 'Work Mac' }).expect(200);
    const id = await added();
    expect(desktop.posted.at(-1)).toMatchObject({
      kind: 'remote-spark:open',
      deviceName: 'Work Mac',
    });

    await local().send('put', '/api/remote-sparks/local', { name: null }).expect(200);
    await local().send('post', `/api/remote-sparks/${id}/open`).expect(200);

    expect(desktop.posted.at(-1)).toMatchObject({
      kind: 'remote-spark:open',
      deviceName: THIS_MAC,
    });
  });
});

describe('icons, names and what leaves this Mac', () => {
  it('writes nothing to the audit, the desktop or a log', async () => {
    const errors = vi.spyOn(console, 'error');
    const logs = vi.spyOn(console, 'log');
    const id = await added();
    const before = await t.db.query('SELECT count(*)::int AS n FROM remote_audit');
    desktop.posted.length = 0;
    desktop.watched.length = 0;

    await local().send('put', `/api/remote-sparks/${id}/icon`, iconBody(FIRST)).expect(200);
    await local().send('put', '/api/remote-sparks/local/icon', iconBody(SECOND)).expect(200);
    await local().send('put', '/api/remote-sparks/local', { name: 'Work Mac' }).expect(200);
    await local().send('delete', `/api/remote-sparks/${id}/icon`).expect(200);

    const after = await t.db.query('SELECT count(*)::int AS n FROM remote_audit');
    expect(after.rows).toEqual(before.rows);
    expect(desktop.posted).toEqual([]);
    expect(desktop.watched).toEqual([]);
    expect(JSON.stringify([...errors.mock.calls, ...logs.mock.calls])).not.toContain('Work Mac');
    vi.restoreAllMocks();
  });

  it('refuses every icon and name route to a paired device', async () => {
    const id = await added();
    await local().send('put', `/api/remote-sparks/${id}/icon`, iconBody(FIRST)).expect(200);
    await local().send('put', '/api/remote-sparks/local/icon', iconBody(FIRST)).expect(200);
    await turnRemoteOn(app);
    const device = await pairDevice(app, 'Other Mac');
    const paired = remoteClient(app, device.cookie);

    await paired.get(`/api/remote-sparks/${id}/icon`).expect(403);
    await paired.send('put', `/api/remote-sparks/${id}/icon`, iconBody(SECOND)).expect(403);
    await paired.send('delete', `/api/remote-sparks/${id}/icon`).expect(403);
    await paired.send('put', '/api/remote-sparks/local', { name: 'Taken over' }).expect(403);
    await paired.get('/api/remote-sparks/local/icon').expect(403);
    await paired.send('put', '/api/remote-sparks/local/icon', iconBody(SECOND)).expect(403);
    await paired.send('delete', '/api/remote-sparks/local/icon').expect(403);
    await remoteClient(app).get('/api/remote-sparks/local/icon').expect(401);

    expect((await list()).local.name).toBeNull();
    await expectIcon(`/api/remote-sparks/${id}/icon`, FIRST);
    await expectIcon('/api/remote-sparks/local/icon', FIRST);
  });
});

describe('reset and icons', () => {
  it('clears every icon and this Mac’s name', async () => {
    const id = await added();
    await local().send('put', `/api/remote-sparks/${id}/icon`, iconBody(FIRST)).expect(200);
    await local().send('put', '/api/remote-sparks/local/icon', iconBody(SECOND)).expect(200);
    await local().send('put', '/api/remote-sparks/local', { name: 'Work Mac' }).expect(200);
    expect(await iconCount()).toBe(2);

    const response = await postReset(t, secrets, { keepApiKeys: true }).expect(200);

    expect(response.body.problems).toEqual([]);
    expect(await iconCount()).toBe(0);
    expect(await list()).toEqual({
      available: true,
      local: { name: null, defaultName: THIS_MAC, icon: null },
      sparks: [],
    });
    await local().get('/api/remote-sparks/local/icon').expect(404);
  });
});
