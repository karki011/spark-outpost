import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REMOTE_SPARKS_MAX, remoteSparkListSchema } from '@spark-outpost/contracts';
import { memorySecretStore, remoteSparkSecret, type SecretStore } from '../src/setup/secrets.ts';
import { localClient } from './app-support.ts';
import {
  STUDIO,
  STUDIO_COOKIE,
  everyRow,
  fakeDesktop,
  sparkApp,
  type FakeDesktop,
} from './remote-sparks-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

let t: TestDb;
let secrets: SecretStore;
let desktop: FakeDesktop;
let app: ReturnType<typeof sparkApp>;

beforeEach(async () => {
  t = await createTestDb();
  secrets = memorySecretStore();
  desktop = fakeDesktop();
  app = sparkApp(t, secrets, desktop);
  await watches(1);
});

afterEach(async () => {
  await t.cleanup();
});

const UNKNOWN = '0198c0de-0000-7000-8000-000000000001';
const GARAGE = 'garage.tail1234.ts.net';
const GARAGE_COOKIE = 'garage-device-cookie';

const watches = (count: number, on = desktop) => eventually(async () => on.watched.length >= count);

async function added(hostname = STUDIO): Promise<string> {
  const response = await localClient(app)
    .send('post', '/api/remote-sparks', { address: `https://${hostname}`, name: hostname })
    .expect(201);
  return (response.body as { id: string }).id;
}

const list = async (on = app) =>
  remoteSparkListSchema.parse((await localClient(on).get('/api/remote-sparks').expect(200)).body);

async function stateOf(id: string) {
  const spark = (await list()).sparks.find((entry) => entry.id === id)!;
  return { status: spark.status, needsYou: spark.needsYou };
}

async function paired(hostname = STUDIO, cookie = STUDIO_COOKIE): Promise<string> {
  const id = await added(hostname);
  const before = desktop.watched.length;
  desktop.send({ kind: 'remote-spark:cookie', id, hostname, value: cookie });
  await watches(before + 1);
  return id;
}

const report = (id: string, status: 'online' | 'offline', needsYou: number) =>
  desktop.send({ kind: 'remote-spark:status', id, status, needsYou });

describe('the status of saved Sparks in the list', () => {
  it('is not paired, then checking, then what the desktop app reports', async () => {
    const response = await localClient(app)
      .send('post', '/api/remote-sparks', { address: `https://${STUDIO}`, name: 'Studio Mac' })
      .expect(201);
    const id = (response.body as { id: string }).id;
    expect(response.body).toMatchObject({ paired: false, status: 'not-paired', needsYou: 0 });

    desktop.send({ kind: 'remote-spark:cookie', id, hostname: STUDIO, value: STUDIO_COOKIE });
    await watches(2);
    expect(await stateOf(id)).toEqual({ status: 'checking', needsYou: 0 });

    report(id, 'online', 3);
    await eventually(async () => (await stateOf(id)).status === 'online');
    expect(await stateOf(id)).toEqual({ status: 'online', needsYou: 3 });
    const opened = await localClient(app).send('post', `/api/remote-sparks/${id}/open`).expect(200);
    expect(opened.body).toMatchObject({ status: 'online', needsYou: 3 });
    const renamed = await localClient(app)
      .send('patch', `/api/remote-sparks/${id}`, { name: 'Garage Mac' })
      .expect(200);
    expect(renamed.body).toMatchObject({ status: 'online', needsYou: 3 });

    report(id, 'offline', 5);
    await eventually(async () => (await stateOf(id)).status === 'offline');
    expect(await stateOf(id)).toEqual({ status: 'offline', needsYou: 0 });
  });

  it('stays not paired when a report arrives for a Spark with no sign-in', async () => {
    const id = await added();
    const other = await paired(GARAGE, GARAGE_COOKIE);

    report(id, 'online', 2);
    report(other, 'online', 1);

    await eventually(async () => (await stateOf(other)).status === 'online');
    expect(await stateOf(id)).toEqual({ status: 'not-paired', needsYou: 0 });
  });

  it('ignores a report for an unknown Spark and one that is not a report', async () => {
    const id = await paired();
    const before = await list();

    report(UNKNOWN, 'online', 4);
    desktop.send({ kind: 'remote-spark:status', id, status: 'not-paired', needsYou: 0 });
    desktop.send({ kind: 'remote-spark:status', id, status: 'online', needsYou: 1000 });
    desktop.send({ kind: 'remote-spark:status', id, status: 'online', needsYou: -1 });
    desktop.send({ kind: 'remote-spark:status', id, status: 'online' });
    report(id, 'online', 0);
    report(id, 'online', 999);

    await eventually(async () => (await stateOf(id)).needsYou === 999);
    expect((await list()).sparks.map((spark) => spark.id)).toEqual(
      before.sparks.map((spark) => spark.id),
    );
    expect(desktop.watched).toHaveLength(2);
  });

  it('never stores a report in the database', async () => {
    const id = await paired();
    const before = await everyRow(t);

    report(id, 'online', 7);

    await eventually(async () => (await stateOf(id)).status === 'online');
    expect(await everyRow(t)).toBe(before);
  });

  it('forgets a report when the window signs out', async () => {
    const id = await paired();
    report(id, 'online', 3);
    await eventually(async () => (await stateOf(id)).status === 'online');

    desktop.send({ kind: 'remote-spark:signed-out', id });

    await watches(3);
    expect(await stateOf(id)).toEqual({ status: 'not-paired', needsYou: 0 });
    await secrets.set(remoteSparkSecret(id), STUDIO_COOKIE);
    expect(await stateOf(id)).toEqual({ status: 'checking', needsYou: 0 });
  });

  it('forgets a report when a new sign-in is captured', async () => {
    const id = await paired();
    report(id, 'online', 3);
    await eventually(async () => (await stateOf(id)).status === 'online');

    desktop.send({ kind: 'remote-spark:cookie', id, hostname: STUDIO, value: 'a-newer-cookie' });

    await watches(3);
    expect(await stateOf(id)).toEqual({ status: 'checking', needsYou: 0 });
    expect(desktop.watched.at(-1)).toEqual([
      { id, hostname: STUDIO, cookie: 'a-newer-cookie', access: null },
    ]);
  });

  it('keeps a report when the desktop app echoes the sign-in it was given', async () => {
    const id = await paired();
    report(id, 'online', 3);
    await eventually(async () => (await stateOf(id)).status === 'online');
    const sent = desktop.watched.length;

    desktop.send({ kind: 'remote-spark:cookie', id, hostname: STUDIO, value: STUDIO_COOKIE });
    report(id, 'online', 4);

    await eventually(async () => (await stateOf(id)).needsYou === 4);
    expect(desktop.watched).toHaveLength(sent);
  });

  it('forgets a report when the Spark is removed', async () => {
    const id = await paired();
    report(id, 'online', 3);
    await eventually(async () => (await stateOf(id)).status === 'online');

    await localClient(app).send('delete', `/api/remote-sparks/${id}`).expect(204);
    await t.db.query(
      'INSERT INTO remote_sparks (id, workspace_id, name, hostname) VALUES ($1, $2, $3, $4)',
      [id, t.workspaceId, 'Studio Mac', STUDIO],
    );
    await secrets.set(remoteSparkSecret(id), STUDIO_COOKIE);

    expect(await stateOf(id)).toEqual({ status: 'checking', needsYou: 0 });
  });
});

describe('the list the desktop app watches', () => {
  it('is sent when the bridge connects, with the Sparks that have a sign-in', async () => {
    const signedIn = await added();
    await added(GARAGE);
    await secrets.set(remoteSparkSecret(signedIn), STUDIO_COOKIE);
    const restarted = fakeDesktop();

    sparkApp(t, secrets, restarted);

    await watches(1, restarted);
    expect(desktop.watched).toEqual([[]]);
    expect(restarted.watched).toEqual([
      [{ id: signedIn, hostname: STUDIO, cookie: STUDIO_COOKIE, access: null }],
    ]);
    expect(restarted.posted).toEqual([]);
  });

  it('is sent again after a sign-in, a sign-out and a removal, and not after an add', async () => {
    const studio = await paired();
    const garage = await added(GARAGE);
    expect(desktop.watched).toEqual([
      [],
      [{ id: studio, hostname: STUDIO, cookie: STUDIO_COOKIE, access: null }],
    ]);

    desktop.send({
      kind: 'remote-spark:cookie',
      id: garage,
      hostname: GARAGE,
      value: GARAGE_COOKIE,
    });
    await watches(3);
    expect(desktop.watched.at(-1)).toEqual([
      { id: studio, hostname: STUDIO, cookie: STUDIO_COOKIE, access: null },
      { id: garage, hostname: GARAGE, cookie: GARAGE_COOKIE, access: null },
    ]);

    desktop.send({ kind: 'remote-spark:signed-out', id: studio });
    await watches(4);
    expect(desktop.watched.at(-1)).toEqual([
      { id: garage, hostname: GARAGE, cookie: GARAGE_COOKIE, access: null },
    ]);

    await localClient(app).send('delete', `/api/remote-sparks/${garage}`).expect(204);
    expect(desktop.watched).toHaveLength(5);
    expect(desktop.watched.at(-1)).toEqual([]);
  });

  it('is not sent for a sign-in the keychain did not take', async () => {
    const id = await added();

    desktop.send({ kind: 'remote-spark:cookie', id, hostname: GARAGE, value: STUDIO_COOKIE });
    desktop.send({ kind: 'remote-spark:cookie', id: UNKNOWN, hostname: STUDIO, value: 'x' });
    report(id, 'online', 1);
    desktop.send({ kind: 'remote-spark:cookie', id, hostname: STUDIO, value: STUDIO_COOKIE });

    await watches(2);
    expect(desktop.watched).toHaveLength(2);
  });

  it('is emptied by a reset', async () => {
    const id = await paired();
    report(id, 'online', 2);
    await eventually(async () => (await stateOf(id)).status === 'online');

    await localClient(app).send('post', '/api/reset', { keepApiKeys: true }).expect(200);

    expect(desktop.watched.at(-1)).toEqual([]);
    expect(desktop.watched).toHaveLength(3);
    expect((await list()).sparks).toEqual([]);
  });

  it('leaves out a Spark whose keychain entry is too long or cannot be read', async () => {
    const studio = await added();
    const garage = await added(GARAGE);
    await secrets.set(remoteSparkSecret(studio), 'v'.repeat(513));
    await secrets.set(remoteSparkSecret(garage), GARAGE_COOKIE);
    const second = fakeDesktop();
    sparkApp(t, secrets, second);
    await watches(1, second);
    expect(second.watched).toEqual([
      [{ id: garage, hostname: GARAGE, cookie: GARAGE_COOKIE, access: null }],
    ]);

    const locked = fakeDesktop();
    sparkApp(
      t,
      { ...secrets, get: () => Promise.reject(new Error('The keychain is locked.')) },
      locked,
    );
    await watches(1, locked);
    expect(locked.watched).toEqual([[]]);
  });

  it('holds the earliest Sparks when more are paired than it can carry', async () => {
    const ids: string[] = [];
    for (let index = 0; index < REMOTE_SPARKS_MAX + 2; index += 1) {
      const id = randomUUID();
      ids.push(id);
      await t.db.query(
        `INSERT INTO remote_sparks (id, workspace_id, name, hostname, created_at)
         VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5))`,
        [id, t.workspaceId, `Mac ${index}`, `mac${index}.tail1234.ts.net`, index],
      );
      if (index !== 1) await secrets.set(remoteSparkSecret(id), `cookie-${index}`);
    }
    const crowded = fakeDesktop();

    sparkApp(t, secrets, crowded);

    await watches(1, crowded);
    const expected = ids.filter((_, index) => index !== 1).slice(0, REMOTE_SPARKS_MAX);
    expect(crowded.watched[0]!.map((spark) => spark.id)).toEqual(expected);
  });

  it('is not sent outside the desktop app', async () => {
    const plain = sparkApp(t, secrets, null);
    const id = await added();
    await secrets.set(remoteSparkSecret(id), STUDIO_COOKIE);

    expect(await list(plain)).toMatchObject({
      available: false,
      sparks: [{ id, paired: true, status: 'checking', needsYou: 0 }],
    });
  });

  it('puts the cookie in no response, row or log line', async () => {
    const errors = vi.spyOn(console, 'error');
    const logs = vi.spyOn(console, 'log');
    const id = await paired();
    report(id, 'online', 2);
    await eventually(async () => (await stateOf(id)).status === 'online');

    const responses = [
      await localClient(app).get('/api/remote-sparks'),
      await localClient(app).send('patch', `/api/remote-sparks/${id}`, { name: 'Studio' }),
      await localClient(app).send('post', `/api/remote-sparks/${id}/open`),
      await localClient(app).send('delete', `/api/remote-sparks/${id}`),
    ];

    expect(JSON.stringify(responses.map((response) => response.body))).not.toContain(STUDIO_COOKIE);
    expect(await everyRow(t)).not.toContain(STUDIO_COOKIE);
    expect(JSON.stringify([...errors.mock.calls, ...logs.mock.calls])).not.toContain(STUDIO_COOKIE);
    vi.restoreAllMocks();
  });
});
