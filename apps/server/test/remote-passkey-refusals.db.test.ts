import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RemoteDevice } from '@spark-outpost/contracts';
import { createTestApp, localClient } from './app-support.ts';
import { assertPasskey, type SoftPasskey } from './passkey-authenticator.ts';
import {
  SIGN_IN_REFUSED,
  deviceCookieIn,
  finishSignIn,
  passkeyAudit,
  savePasskey,
  signIn,
  signedIn,
  startSignIn,
} from './remote-passkey-support.ts';
import {
  ENTERED,
  REMOTE_ORIGIN,
  pairDevice,
  remoteClient,
  setSwitches,
  turnRemoteOn,
  type PairedDevice,
} from './remote-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let app: ReturnType<typeof createTestApp>;
let device: PairedDevice;
let passkey: SoftPasskey;

beforeEach(async () => {
  t = await createTestDb();
  app = createTestApp(t);
  await turnRemoteOn(app);
  device = await pairDevice(app, 'Kitchen phone');
  passkey = await savePasskey(app, device);
});

afterEach(async () => {
  await t.cleanup();
});

const devices = async (): Promise<RemoteDevice[]> =>
  (await localClient(app).get('/api/remote/devices').expect(200)).body.devices;

const reasons = async () =>
  (await passkeyAudit(t, 'passkey_sign_in_failed')).map((row) => [row.device_id, row.detail]);

const count = async (table: string): Promise<number> =>
  Number((await t.db.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`)).rows[0]!.n);

const refused = async (response: { status: number; body: unknown; headers: object }) => {
  expect(response.status).toBe(403);
  expect(response.body).toEqual({ error: SIGN_IN_REFUSED });
  expect(deviceCookieIn(response.headers as Record<string, unknown>)).toBeNull();
};

describe('a passkey sign-in is refused, with one answer', () => {
  it('for a passkey this Mac does not know', async () => {
    await refused(await signIn(app, { ...passkey, credentialId: 'bm90LWEta25vd24ta2V5' }));
    expect(await reasons()).toEqual([[null, { reason: 'unknown_credential' }]]);
  });

  it('for a removed device, at once', async () => {
    const started = await startSignIn(app);
    await localClient(app).send('delete', `/api/remote/devices/${device.id}`).expect(200);
    await refused(
      await finishSignIn(
        app,
        started.ticket,
        assertPasskey(passkey, started.options, { origin: REMOTE_ORIGIN }),
      ),
    );
    expect(await reasons()).toEqual([[null, { reason: 'unknown_credential' }]]);
    expect(await count('remote_passkeys')).toBe(0);
  });

  it('for a removed device even if its passkey row were still there', async () => {
    await t.db.query('UPDATE remote_devices SET revoked_at = now()');
    await refused(await signIn(app, passkey));
    expect(await reasons()).toEqual([[device.id, { reason: 'device_revoked' }]]);
  });

  it('for a device not used for 30 days', async () => {
    await t.db.query(`UPDATE remote_devices SET last_seen_at = now() - interval '31 days'`);
    await refused(await signIn(app, passkey));
    expect(await reasons()).toEqual([[device.id, { reason: 'device_unused' }]]);
    expect((await devices())[0]).toMatchObject({ expired: true });
    await remoteClient(app, device.cookie).get('/api/conversations').expect(401);
  });

  it('for a reused challenge, a missing ticket and another browser ticket', async () => {
    const started = await startSignIn(app);
    const assertion = assertPasskey(passkey, started.options, { origin: REMOTE_ORIGIN });
    await finishSignIn(app, started.ticket, assertion).expect(200);
    await refused(await finishSignIn(app, started.ticket, assertion));

    const untied = await startSignIn(app);
    const untiedAssertion = assertPasskey(passkey, untied.options, { origin: REMOTE_ORIGIN });
    await refused(await finishSignIn(app, null, untiedAssertion));

    const mine = await startSignIn(app);
    const theirs = await startSignIn(app);
    await refused(
      await finishSignIn(
        app,
        theirs.ticket,
        assertPasskey(passkey, mine.options, { origin: REMOTE_ORIGIN }),
      ),
    );
    await refused(
      await finishSignIn(
        app,
        mine.ticket,
        assertPasskey(passkey, mine.options, { origin: REMOTE_ORIGIN }),
      ),
    );
    expect((await reasons()).map(([, detail]) => detail)).toEqual([
      { reason: 'challenge' },
      { reason: 'challenge' },
      { reason: 'challenge' },
      { reason: 'challenge' },
    ]);
  });

  it('for another site, another RP ID, an unverified user and a bad signature', async () => {
    await refused(await signIn(app, passkey, { origin: 'https://evil.example' }));
    await refused(await signIn(app, passkey, { rpId: 'evil.example' }));
    await refused(await signIn(app, passkey, { userVerified: false }));
    const stranger = await savePasskey(app, device);
    await refused(await signIn(app, { ...passkey, privateKey: stranger.privateKey }));
    expect(await reasons()).toEqual([
      [device.id, { reason: 'verification' }],
      [device.id, { reason: 'verification' }],
      [device.id, { reason: 'verification' }],
      [device.id, { reason: 'verification' }],
    ]);
  });

  it('for a passkey presented with another device user handle', async () => {
    const other = await pairDevice(app, 'Hall phone');
    const theirs = await savePasskey(app, other);
    await refused(await signIn(app, { ...passkey, userHandle: theirs.userHandle }));
    expect(await reasons()).toEqual([[device.id, { reason: 'wrong_device' }]]);
  });

  it('when the switch is off, and the pairing page stops offering it', async () => {
    const started = await startSignIn(app);
    expect((await remoteClient(app).get(`/${ENTERED}`)).text).toContain('Sign in with a passkey');
    await setSwitches(app, { passkeys: false });

    const page = await remoteClient(app).get(`/${ENTERED}`).expect(200);
    expect(page.text).toContain('Pair this device');
    expect(page.text).not.toContain('Sign in with a passkey');
    expect(page.text).not.toContain('id="passkey"');
    expect(page.text).not.toContain('/api/remote/passkey');
    await remoteClient(app).send('post', '/api/remote/passkey/sign-in/options').expect(401);
    const assertion = assertPasskey(passkey, started.options, { origin: REMOTE_ORIGIN });
    const answer = await finishSignIn(app, started.ticket, assertion).expect(401);
    expect(deviceCookieIn(answer.headers)).toBeNull();
    await remoteClient(app, device.cookie)
      .send('post', '/api/remote/passkey/sign-in/options')
      .expect(403);

    await setSwitches(app, { passkeys: true });
    await signedIn(app, passkey);
  });

  it('when phone access is off, and from the Mac itself', async () => {
    const started = await startSignIn(app);
    const assertion = assertPasskey(passkey, started.options, { origin: REMOTE_ORIGIN });
    await localClient(app).send('post', '/api/remote/passkey/sign-in/options').expect(404);
    await localClient(app).send('post', '/api/remote/passkey/sign-in', assertion).expect(404);
    await turnRemoteOn(app, null);
    await remoteClient(app).send('post', '/api/remote/passkey/sign-in/options').expect(403);
    await finishSignIn(app, started.ticket, assertion).expect(403);
    await turnRemoteOn(app);
    await signedIn(app, passkey);
  });

  it('after five attempts in a minute, for everyone', async () => {
    const unknown = { ...passkey, credentialId: 'bm90LWEta25vd24ta2V5' };
    const tickets = [];
    for (let attempt = 0; attempt < 5; attempt += 1) tickets.push(await startSignIn(app));
    const limited = await remoteClient(app)
      .send('post', '/api/remote/passkey/sign-in/options')
      .expect(429);
    expect(limited.body.error).toBe('Too many passkey attempts. Wait a minute and try again.');
    for (const started of tickets) {
      const assertion = assertPasskey(unknown, started.options, { origin: REMOTE_ORIGIN });
      await finishSignIn(app, started.ticket, assertion).expect(403);
    }
    const last = tickets.at(-1)!;
    const real = assertPasskey(passkey, last.options, { origin: REMOTE_ORIGIN });
    await finishSignIn(app, last.ticket, real).expect(429);
    expect(await reasons()).toHaveLength(5);
  });
});

describe('removing passkeys', () => {
  it('revoking a device deletes its passkeys and ends every sign-in', async () => {
    const second = deviceCookieIn((await signedIn(app, passkey)).headers)!;
    await localClient(app).send('delete', `/api/remote/devices/${device.id}`).expect(200);
    expect(await count('remote_passkeys')).toBe(0);
    expect(await count('remote_device_sessions')).toBe(0);
    await remoteClient(app, second).get('/api/conversations').expect(401);
    await remoteClient(app, device.cookie).get('/api/conversations').expect(401);
    await refused(await signIn(app, passkey));
  });

  it('disconnect all deletes every passkey', async () => {
    const other = await pairDevice(app, 'Hall phone');
    const theirs = await savePasskey(app, other);
    await localClient(app).send('post', '/api/remote/devices/disconnect-all').expect(200);
    expect(await count('remote_passkeys')).toBe(0);
    await refused(await signIn(app, passkey));
    await refused(await signIn(app, theirs));
  });

  it('pairing again over a run-out sign-in deletes the old passkeys', async () => {
    await t.db.query(`UPDATE remote_devices SET last_seen_at = now() - interval '31 days'`);
    const again = await pairDevice(app, 'Kitchen phone', undefined, device.cookie);
    expect(again.id).not.toBe(device.id);
    expect(await count('remote_passkeys')).toBe(0);
    await refused(await signIn(app, passkey));
  });

  it('the Mac removes a device passkeys, ends their sign-ins and keeps the device', async () => {
    const other = await pairDevice(app, 'Hall phone');
    const theirs = await savePasskey(app, other);
    const second = deviceCookieIn((await signedIn(app, passkey)).headers)!;

    const removed = await localClient(app)
      .send('delete', `/api/remote/devices/${device.id}/passkeys`)
      .expect(200);
    const listed = removed.body.devices as RemoteDevice[];
    expect(listed.find((row) => row.id === device.id)).toMatchObject({
      revokedAt: null,
      passkeys: [],
    });
    expect(listed.find((row) => row.id === other.id)!.passkeys).toHaveLength(1);
    await remoteClient(app, device.cookie).get('/api/conversations').expect(200);
    await remoteClient(app, second).get('/api/conversations').expect(401);
    await refused(await signIn(app, passkey));
    await signedIn(app, theirs);
    expect(await passkeyAudit(t, 'device_passkeys_removed')).toEqual([
      { device_id: device.id, detail: { count: 1 } },
    ]);
    await localClient(app)
      .send('delete', `/api/remote/devices/${crypto.randomUUID()}/passkeys`)
      .expect(404);
  });

  it('a phone cannot remove passkeys or change the switch', async () => {
    const phone = remoteClient(app, device.cookie);
    await phone.send('delete', `/api/remote/devices/${device.id}/passkeys`).expect(403);
    await phone.send('patch', '/api/remote/switches', { passkeys: false }).expect(403);
    expect(await count('remote_passkeys')).toBe(1);
  });
});
