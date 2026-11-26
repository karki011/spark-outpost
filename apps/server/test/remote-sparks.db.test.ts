import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SPARK_ADDRESS_PROBLEMS, remoteSparkListSchema } from '@spark-outpost/contracts';
import { memorySecretStore, remoteSparkSecret, type SecretStore } from '../src/setup/secrets.ts';
import { localClient } from './app-support.ts';
import { REMOTE_HOST, pairDevice, remoteClient, turnRemoteOn } from './remote-support.ts';
import {
  STUDIO,
  STUDIO_COOKIE,
  THIS_MAC,
  cookieIn,
  everyRow,
  fakeDesktop,
  sparkApp,
  type FakeDesktop,
} from './remote-sparks-support.ts';
import { postReset, recordingStore } from './reset-support.ts';
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
});

afterEach(async () => {
  await t.cleanup();
});

const UNKNOWN = '0198c0de-0000-7000-8000-000000000001';
const UNNAMED = { name: null, defaultName: THIS_MAC, icon: null };

const add = (address: string, name = 'Studio Mac', on = app, trusted?: boolean) =>
  localClient(on).send('post', '/api/remote-sparks', { address, name, trusted });

const list = async (on = app) =>
  remoteSparkListSchema.parse((await localClient(on).get('/api/remote-sparks').expect(200)).body);

async function added(address = `https://${STUDIO}`): Promise<string> {
  return ((await add(address).expect(201)).body as { id: string }).id;
}

describe('saved Sparks', () => {
  it('saves another computer and opens its window with this computer’s name', async () => {
    const response = await add(`https://${STUDIO}/#code=ABCD-EFGH-JKLM`).expect(201);

    expect(response.body).toMatchObject({
      name: 'Studio Mac',
      hostname: STUDIO,
      reach: 'tailscale',
      paired: false,
    });
    expect(response.body.lastOpenedAt).not.toBeNull();
    expect(desktop.posted).toEqual([
      {
        kind: 'remote-spark:open',
        id: response.body.id,
        name: 'Studio Mac',
        hostname: STUDIO,
        deviceName: THIS_MAC,
        code: 'ABCD-EFGH-JKLM',
        cookie: null,
      },
    ]);
    expect(await list()).toEqual({ available: true, local: UNNAMED, sparks: [response.body] });
    expect(await everyRow(t)).not.toContain('ABCD-EFGH-JKLM');
  });

  it('opens with no code when only the address was pasted', async () => {
    await add(`  ${STUDIO.toUpperCase()}  `, '  Studio Mac ').expect(201);

    expect(desktop.posted).toEqual([
      expect.objectContaining({ hostname: STUDIO, name: 'Studio Mac', code: null }),
    ]);
  });

  it('refuses the same computer twice', async () => {
    await added();
    const again = await add(`https://${STUDIO}/`, 'Studio again').expect(409);

    expect(again.body.error).toBe('That computer is already in your list.');
    expect((await list()).sparks).toHaveLength(1);
    expect(desktop.posted).toHaveLength(1);
  });

  it('refuses an address it cannot use, in plain words', async () => {
    await turnRemoteOn(app);
    const refused: [string, keyof typeof SPARK_ADDRESS_PROBLEMS][] = [
      [`http://${STUDIO}`, 'scheme'],
      [`https://${STUDIO}:8443`, 'shape'],
      [`https://${STUDIO}/chats`, 'shape'],
      [`https://me:pw@${STUDIO}`, 'shape'],
      [`https://${STUDIO}/?next=1`, 'shape'],
      ['https://studio.example.com', 'untrusted'],
      ['https://127.0.0.1', 'host'],
      [`https://${REMOTE_HOST}`, 'own'],
    ];
    for (const [address, problem] of refused) {
      const response = await add(address).expect(400);
      expect([address, response.body]).toEqual([
        address,
        { error: SPARK_ADDRESS_PROBLEMS[problem], problem },
      ]);
    }
    await add('   ').expect(400);
    await add(`https://${STUDIO}`, '').expect(400);
    await add(`https://${STUDIO}`, 'n'.repeat(61)).expect(400);
    expect((await list()).sparks).toEqual([]);
    expect(desktop.posted).toEqual([]);
  });

  it('adds a Spark at a custom domain only once it is trusted', async () => {
    const address = 'https://studio.example.com/#code=ABCD-EFGH-JKLM';
    for (const trusted of [undefined, false]) {
      const refused = await add(address, 'Studio Mac', app, trusted).expect(400);
      expect(refused.body).toEqual({
        error: SPARK_ADDRESS_PROBLEMS.untrusted,
        problem: 'untrusted',
      });
    }
    expect((await list()).sparks).toEqual([]);
    expect(desktop.posted).toEqual([]);

    const saved = await add(address, 'Studio Mac', app, true).expect(201);
    expect(saved.body).toMatchObject({ hostname: 'studio.example.com', reach: 'custom' });
    expect(desktop.posted).toMatchObject([
      { kind: 'remote-spark:open', hostname: 'studio.example.com', code: 'ABCD-EFGH-JKLM' },
    ]);
    expect((await list()).sparks).toMatchObject([{ reach: 'custom' }]);
  });

  it('adds a Tailscale Spark whatever the trusted flag says', async () => {
    const saved = await add(`https://${STUDIO}`, 'Studio Mac', app, false).expect(201);
    expect(saved.body).toMatchObject({ hostname: STUDIO, reach: 'tailscale' });
  });

  it('renames a saved Spark', async () => {
    const id = await added();
    const renamed = await localClient(app)
      .send('patch', `/api/remote-sparks/${id}`, { name: ' Garage Mac ' })
      .expect(200);

    expect(renamed.body).toMatchObject({ id, name: 'Garage Mac', hostname: STUDIO });
    expect((await list()).sparks.map((spark) => spark.name)).toEqual(['Garage Mac']);
    await localClient(app).send('patch', `/api/remote-sparks/${id}`, { name: '' }).expect(400);
    await localClient(app)
      .send('patch', `/api/remote-sparks/${UNKNOWN}`, { name: 'Nobody' })
      .expect(404);
  });

  it('opens a saved Spark signed in when the keychain has its cookie', async () => {
    const id = await added();
    await secrets.set(remoteSparkSecret(id), STUDIO_COOKIE);

    const opened = await localClient(app).send('post', `/api/remote-sparks/${id}/open`).expect(200);

    expect(opened.body).toMatchObject({ id, paired: true });
    expect(desktop.posted.at(-1)).toEqual({
      kind: 'remote-spark:open',
      id,
      name: 'Studio Mac',
      hostname: STUDIO,
      deviceName: THIS_MAC,
      code: null,
      cookie: STUDIO_COOKIE,
    });
    expect(JSON.stringify(opened.body)).not.toContain(STUDIO_COOKIE);
    expect(JSON.stringify(await list())).not.toContain(STUDIO_COOKIE);
    expect(await everyRow(t)).not.toContain(STUDIO_COOKIE);
  });

  it('records when a saved Spark was last opened', async () => {
    const id = await added();
    await t.db.query('UPDATE remote_sparks SET last_opened_at = NULL');
    expect((await list()).sparks[0]!.lastOpenedAt).toBeNull();

    await localClient(app).send('post', `/api/remote-sparks/${id}/open`).expect(200);

    expect((await list()).sparks[0]!.lastOpenedAt).not.toBeNull();
    await localClient(app).send('post', `/api/remote-sparks/${UNKNOWN}/open`).expect(404);
  });

  it('opens unsigned when the keychain cannot be read', async () => {
    const id = await added();
    await secrets.set(remoteSparkSecret(id), STUDIO_COOKIE);
    const broken: SecretStore = {
      ...secrets,
      get: () => Promise.reject(new Error('The keychain is locked.')),
    };
    const locked = fakeDesktop();
    const lockedApp = sparkApp(t, broken, locked);

    await localClient(lockedApp).send('post', `/api/remote-sparks/${id}/open`).expect(200);

    expect(locked.posted).toEqual([expect.objectContaining({ id, cookie: null })]);
    expect((await list(lockedApp)).sparks).toEqual([expect.objectContaining({ paired: false })]);
  });

  it('removes a saved Spark with its keychain entry and closes its window', async () => {
    const id = await added();
    await secrets.set(remoteSparkSecret(id), STUDIO_COOKIE);

    await localClient(app).send('delete', `/api/remote-sparks/${id}`).expect(204);

    expect(await cookieIn(secrets, id)).toBeNull();
    expect((await list()).sparks).toEqual([]);
    expect(desktop.posted.at(-1)).toEqual({ kind: 'remote-spark:close', id });
    await localClient(app).send('delete', `/api/remote-sparks/${id}`).expect(404);
    await added();
  });

  it('saves without a window outside the desktop app, and says it cannot open one', async () => {
    const plain = sparkApp(t, secrets, null);
    const response = await add(`https://${STUDIO}`, 'Studio Mac', plain).expect(201);

    expect(response.body.lastOpenedAt).toBeNull();
    expect(await list(plain)).toEqual({
      available: false,
      local: UNNAMED,
      sparks: [response.body],
    });
    const refused = await localClient(plain)
      .send('post', `/api/remote-sparks/${response.body.id}/open`)
      .expect(409);
    expect(refused.body.error).toContain('Spark Outpost app');
  });
});

describe('the cookie the desktop captures', () => {
  const captured = (id: string, hostname = STUDIO, value = STUDIO_COOKIE) => ({
    kind: 'remote-spark:cookie',
    id,
    hostname,
    value,
  });

  it('goes to the keychain and nowhere else', async () => {
    const errors = vi.spyOn(console, 'error');
    const logs = vi.spyOn(console, 'log');
    const id = await added();

    desktop.send(captured(id));

    await eventually(async () => (await cookieIn(secrets, id)) === STUDIO_COOKIE);
    const listed = await list();
    expect(listed.sparks).toEqual([expect.objectContaining({ id, paired: true })]);
    expect(JSON.stringify(listed)).not.toContain(STUDIO_COOKIE);
    expect(await everyRow(t)).not.toContain(STUDIO_COOKIE);
    expect(JSON.stringify([...errors.mock.calls, ...logs.mock.calls])).not.toContain(STUDIO_COOKIE);
    vi.restoreAllMocks();
  });

  it('is not stored for another hostname or an unknown Spark', async () => {
    const id = await added();

    desktop.send(captured(id, 'other.tail1234.ts.net'));
    desktop.send(captured(UNKNOWN));
    desktop.send(captured(id, STUDIO, ''));
    desktop.send(captured(id, STUDIO, 'v'.repeat(513)));
    desktop.send({ ...captured(id), kind: 'remote-spark:open' });
    desktop.send('remote-spark:cookie');
    desktop.send(null);
    desktop.send(captured(id, STUDIO, 'the-real-one'));

    await eventually(async () => (await cookieIn(secrets, id)) === 'the-real-one');
    expect(await cookieIn(secrets, UNKNOWN)).toBeNull();
  });

  it('is forgotten when the desktop says the window signed out', async () => {
    const id = await added();
    await secrets.set(remoteSparkSecret(id), STUDIO_COOKIE);

    desktop.send({ kind: 'remote-spark:signed-out', id });

    await eventually(async () => (await cookieIn(secrets, id)) === null);
    expect((await list()).sparks).toEqual([expect.objectContaining({ id, paired: false })]);
  });

  it('does not log the value when the keychain refuses it', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const refusing: SecretStore = {
      ...secrets,
      set: () => Promise.reject(new Error(`could not store ${STUDIO_COOKIE}`)),
    };
    const other = fakeDesktop();
    sparkApp(t, refusing, other);
    const id = await added();

    other.send(captured(id));

    await eventually(async () => errors.mock.calls.length > 0);
    expect(JSON.stringify(errors.mock.calls)).not.toContain(STUDIO_COOKIE);
    vi.restoreAllMocks();
  });
});

describe('saved Sparks and a paired device', () => {
  it('refuses all five routes to a paired device, so no Mac chains to a third', async () => {
    const id = await added();
    await turnRemoteOn(app);
    const device = await pairDevice(app, 'Other Mac');
    const paired = remoteClient(app, device.cookie);
    desktop.posted.length = 0;

    await paired.get('/api/remote-sparks').expect(403);
    await paired
      .send('post', '/api/remote-sparks', { address: 'https://third.tail1234.ts.net', name: 'x' })
      .expect(403);
    await paired.send('patch', `/api/remote-sparks/${id}`, { name: 'Taken over' }).expect(403);
    await paired.send('post', `/api/remote-sparks/${id}/open`).expect(403);
    await paired.send('delete', `/api/remote-sparks/${id}`).expect(403);
    await remoteClient(app).get('/api/remote-sparks').expect(401);

    expect(desktop.posted).toEqual([]);
    expect((await list()).sparks).toEqual([expect.objectContaining({ id, name: 'Studio Mac' })]);
  });
});

describe('reset and saved Sparks', () => {
  it('deletes every saved Spark and its keychain entry', async () => {
    const first = await added();
    const second = await added('https://garage.tail1234.ts.net');
    const recording = recordingStore(secrets);
    await secrets.set(remoteSparkSecret(first), STUDIO_COOKIE);
    await secrets.set(remoteSparkSecret(second), 'garage-cookie');

    const response = await postReset(t, recording, { keepApiKeys: true }).expect(200);

    expect(response.body.problems).toEqual([]);
    expect(recording.deleted).toEqual(
      expect.arrayContaining([remoteSparkSecret(first), remoteSparkSecret(second)]),
    );
    expect(await cookieIn(secrets, first)).toBeNull();
    expect(await cookieIn(secrets, second)).toBeNull();
    expect((await list()).sparks).toEqual([]);
  });
});
