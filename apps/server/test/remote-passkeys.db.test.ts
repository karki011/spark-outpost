import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PASSKEY_TICKET_COOKIE,
  type PasskeyCreationOptions,
  type RemoteDevice,
} from '@spark-outpost/contracts';
import { createTestApp, localClient } from './app-support.ts';
import { createPasskey } from './passkey-authenticator.ts';
import {
  deviceCookieIn,
  passkeyAudit,
  savePasskey,
  signIn,
  signedIn,
  startSignIn,
} from './remote-passkey-support.ts';
import {
  ENTERED,
  REMOTE_HOST,
  REMOTE_ORIGIN,
  deviceTokenIn,
  pairDevice,
  remoteClient,
  setSwitches,
  turnRemoteOn,
} from './remote-support.ts';
import { createTestDb, type TestDb } from './support.ts';

const GOOGLE_PASSWORD_MANAGER = 'ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4';

let t: TestDb;
let app: ReturnType<typeof createTestApp>;

beforeEach(async () => {
  t = await createTestDb();
  app = createTestApp(t);
  await turnRemoteOn(app);
});

afterEach(async () => {
  await t.cleanup();
});

const devices = async (): Promise<RemoteDevice[]> =>
  (await localClient(app).get('/api/remote/devices').expect(200)).body.devices;

const deviceIdOf = async (cookie: string): Promise<string> =>
  (await remoteClient(app, cookie).get('/api/remote/session').expect(200)).body.device.id;

const count = async (table: string): Promise<number> =>
  Number((await t.db.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`)).rows[0]!.n);

describe('saving a passkey', () => {
  it('needs a paired device', async () => {
    await remoteClient(app).send('post', '/api/remote/passkeys/options').expect(401);
    await remoteClient(app).send('post', '/api/remote/passkeys', {}).expect(401);
    await remoteClient(app).get('/api/remote/passkeys').expect(401);
    await localClient(app).send('post', '/api/remote/passkeys/options').expect(404);
    await localClient(app).get('/api/remote/passkeys').expect(404);
    const revoked = await pairDevice(app, 'Old phone');
    await localClient(app).send('delete', `/api/remote/devices/${revoked.id}`).expect(200);
    await remoteClient(app, revoked.cookie)
      .send('post', '/api/remote/passkeys/options')
      .expect(401);
  });

  it('asks for a discoverable, user-verified ES256 or RS256 credential for the Serve host', async () => {
    const device = await pairDevice(app, 'Kitchen phone');
    const asked = await remoteClient(app, device.cookie)
      .send('post', '/api/remote/passkeys/options')
      .expect(200);
    const options = asked.body as PasskeyCreationOptions;
    expect(asked.headers['cache-control']).toBe('no-store');
    expect(options).toMatchObject({
      rp: { id: REMOTE_HOST, name: 'Spark Outpost' },
      user: { name: 'Kitchen phone', displayName: 'Kitchen phone' },
      attestation: 'none',
      excludeCredentials: [],
      authenticatorSelection: {
        residentKey: 'required',
        requireResidentKey: true,
        userVerification: 'required',
      },
    });
    expect(options.pubKeyCredParams.map((param) => param.alg)).toEqual([-7, -257]);
    expect(Buffer.from(options.challenge, 'base64url')).toHaveLength(32);
    expect(Buffer.from(options.user.id, 'base64url').toString('hex')).toBe(
      device.id.replaceAll('-', ''),
    );
  });

  it('binds the passkey to the device and shows it on the Mac', async () => {
    const device = await pairDevice(app, 'Kitchen phone');
    const other = await pairDevice(app, 'Hall phone');
    const first = await savePasskey(app, device, { aaguid: GOOGLE_PASSWORD_MANAGER, synced: true });
    await savePasskey(app, device);

    const own = await remoteClient(app, device.cookie).get('/api/remote/passkeys').expect(200);
    expect(own.body.passkeys).toMatchObject([
      { label: 'Google Password Manager', synced: true, lastUsedAt: null },
      { label: null, synced: false, lastUsedAt: null },
    ]);
    expect((await remoteClient(app, other.cookie).get('/api/remote/passkeys')).body).toEqual({
      passkeys: [],
    });
    const listed = await devices();
    expect(listed.find((row) => row.id === device.id)!.passkeys).toHaveLength(2);
    expect(listed.find((row) => row.id === other.id)!.passkeys).toEqual([]);
    expect(JSON.stringify(listed)).not.toContain(first.credentialId);

    const again = await remoteClient(app, device.cookie)
      .send('post', '/api/remote/passkeys/options')
      .expect(200);
    expect(again.body.excludeCredentials).toHaveLength(2);
    expect(again.body.excludeCredentials[0]).toMatchObject({
      id: first.credentialId,
      type: 'public-key',
    });
    expect(await passkeyAudit(t, 'device_passkey_added')).toEqual([
      { device_id: device.id, detail: { label: 'Google Password Manager', synced: true } },
      { device_id: device.id, detail: { label: null, synced: false } },
    ]);
  });

  it('refuses a wrong, reused or foreign challenge, a wrong site and an unverified user', async () => {
    const device = await pairDevice(app, 'Kitchen phone');
    const other = await pairDevice(app, 'Hall phone');
    const phone = remoteClient(app, device.cookie);
    const ask = async (cookie = device.cookie) =>
      (await remoteClient(app, cookie).send('post', '/api/remote/passkeys/options').expect(200))
        .body as PasskeyCreationOptions;
    const save = (options: PasskeyCreationOptions, ceremony = {}) =>
      phone.send(
        'post',
        '/api/remote/passkeys',
        createPasskey(options, { origin: REMOTE_ORIGIN, ...ceremony }).registration,
      );

    await save(await ask(), { origin: 'https://evil.example' }).expect(400);
    await save(await ask(), { rpId: 'evil.example' }).expect(400);
    await save(await ask(), { userVerified: false }).expect(400);
    await save(await ask(other.cookie)).expect(400);
    await save({ ...(await ask()), challenge: Buffer.alloc(32, 7).toString('base64url') }).expect(
      400,
    );
    const stale = await ask();
    await ask();
    await save(stale).expect(400);

    const options = await ask();
    const { registration } = createPasskey(options, { origin: REMOTE_ORIGIN });
    await phone.send('post', '/api/remote/passkeys', registration).expect(201);
    const replayed = await phone.send('post', '/api/remote/passkeys', registration).expect(400);
    expect(replayed.body).toEqual({ error: 'That passkey could not be saved. Try again.' });
    await phone.send('post', '/api/remote/passkeys', { id: 'x' }).expect(400);
    expect(await count('remote_passkeys')).toBe(1);
  });

  it('refuses when the switch is off', async () => {
    const device = await pairDevice(app);
    await setSwitches(app, { passkeys: false });
    const phone = remoteClient(app, device.cookie);
    const refused = await phone.send('post', '/api/remote/passkeys/options').expect(403);
    expect(refused.body.error).toBe('Turned off for phones on your Mac: Sign in with a passkey.');
    await phone.send('post', '/api/remote/passkeys', {}).expect(403);
    await phone.get('/api/remote/passkeys').expect(403);
  });
});

describe('signing in with a passkey', () => {
  it('signs the same device in on a browser with no cookie and keeps the first browser', async () => {
    const device = await pairDevice(app, 'Kitchen phone');
    const passkey = await savePasskey(app, device);
    await t.db.query(`UPDATE remote_devices SET last_seen_at = now() - interval '3 days'`);

    const started = await startSignIn(app);
    expect(started.options).toEqual({
      rpId: REMOTE_HOST,
      challenge: started.options.challenge,
      timeout: 120_000,
      userVerification: 'required',
    });
    expect(started.setCookie).toMatch(
      new RegExp(
        `^${PASSKEY_TICKET_COOKIE}=[A-Za-z0-9_-]{43}; Path=/; Max-Age=120; HttpOnly; Secure; SameSite=Strict$`,
      ),
    );

    const answer = await signedIn(app, passkey);
    expect(answer.body).toEqual({ status: 'signed_in' });
    expect(answer.headers['cache-control']).toBe('no-store');
    const cookies = answer.headers['set-cookie'] as unknown as string[];
    expect(cookies[0]).toMatch(
      /^__Host-spark_device=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=34560000; HttpOnly; Secure; SameSite=Strict$/,
    );
    expect(cookies[1]).toContain(`${PASSKEY_TICKET_COOKIE}=; Path=/; Max-Age=0`);

    const second = deviceCookieIn(answer.headers)!;
    expect(second).not.toBe(device.cookie);
    expect(await deviceIdOf(second)).toBe(device.id);
    expect(await deviceIdOf(device.cookie)).toBe(device.id);
    await remoteClient(app, second).get('/api/conversations').expect(200);

    const listed = await devices();
    expect(listed).toHaveLength(1);
    expect(Date.now() - new Date(listed[0]!.lastSeenAt).getTime()).toBeLessThan(60_000);
    expect(listed[0]!.passkeys[0]!.lastUsedAt).not.toBeNull();
    expect(await passkeyAudit(t, 'device_passkey_sign_in')).toEqual([
      { device_id: device.id, detail: {} },
    ]);
    expect(await passkeyAudit(t, 'device_paired')).toHaveLength(1);
  });

  it('lands a signed-in browser in the app, not on the pairing page', async () => {
    const device = await pairDevice(app);
    const passkey = await savePasskey(app, device);
    const before = await remoteClient(app).get(`/${ENTERED}`).expect(200);
    expect(before.text).toContain('Sign in with a passkey');
    const cookie = deviceCookieIn((await signedIn(app, passkey)).headers)!;
    const after = await remoteClient(app, cookie).get('/api/remote/session').expect(200);
    expect(after.body).toMatchObject({ remote: true, device: { id: device.id } });
  });

  it('accepts a synced passkey that always reports zero, again and again', async () => {
    const device = await pairDevice(app);
    const passkey = await savePasskey(app, device, { synced: true });
    await signedIn(app, passkey);
    await signedIn(app, passkey);
    expect(await passkeyAudit(t, 'device_passkey_sign_in')).toEqual([
      { device_id: device.id, detail: {} },
      { device_id: device.id, detail: {} },
    ]);
    expect(await count('remote_device_sessions')).toBe(2);
  });

  it('lets a sign-in through when the counter went backwards, and says so in the audit', async () => {
    const device = await pairDevice(app);
    const passkey = await savePasskey(app, device, { counter: 5 });
    await signedIn(app, passkey, { counter: 9 });
    await signedIn(app, passkey, { counter: 3 });
    expect(await passkeyAudit(t, 'device_passkey_sign_in')).toEqual([
      { device_id: device.id, detail: {} },
      { device_id: device.id, detail: { counter: 'regressed' } },
    ]);
    const { rows } = await t.db.query<{ sign_count: string }>(
      'SELECT sign_count FROM remote_passkeys',
    );
    expect(rows).toEqual([{ sign_count: '9' }]);
  });

  it('keeps tokens, challenges, tickets and credential ids out of the audit', async () => {
    const device = await pairDevice(app);
    const passkey = await savePasskey(app, device);
    const started = await startSignIn(app);
    const answer = await signedIn(app, passkey);
    await signIn(app, { ...passkey, credentialId: 'unknown-credential-id' });
    const dump = (
      await t.db.query<{ dump: string }>(
        `SELECT coalesce(json_agg(a), '[]')::text AS dump FROM remote_audit a`,
      )
    ).rows[0]!.dump;
    for (const secret of [
      passkey.credentialId,
      'unknown-credential-id',
      started.options.challenge,
      started.ticket.split('=')[1]!,
      deviceTokenIn(deviceCookieIn(answer.headers)!),
    ]) {
      expect(dump).not.toContain(secret);
    }
  });
});

describe('pairing again from a browser that signed in with a passkey', () => {
  it('replaces that browser sign-in and leaves the paired browser alone', async () => {
    const device = await pairDevice(app, 'Kitchen phone');
    const passkey = await savePasskey(app, device);
    const second = deviceCookieIn((await signedIn(app, passkey)).headers)!;

    const again = await pairDevice(app, 'Kitchen phone', REMOTE_HOST, second);
    expect(again.id).toBe(device.id);
    expect(await devices()).toHaveLength(1);
    await remoteClient(app, second).get('/api/conversations').expect(401);
    await remoteClient(app, again.cookie).get('/api/conversations').expect(200);
    await remoteClient(app, device.cookie).get('/api/conversations').expect(200);
    expect(await count('remote_device_sessions')).toBe(1);
  });
});
