import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PUSH_CONTACT_DEFAULT } from '@spark-outpost/contracts';
import { recordRemoteAudit } from '../src/remote/store.ts';
import { createTestApp, localClient } from './app-support.ts';
import { pairDevice, remoteClient, turnRemoteOn, type PairedDevice } from './remote-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let app: ReturnType<typeof createTestApp>;
let device: PairedDevice;
let mac: ReturnType<typeof localClient>;

beforeEach(async () => {
  t = await createTestDb();
  app = createTestApp(t);
  await turnRemoteOn(app);
  device = await pairDevice(app);
  mac = localClient(app);
});

afterEach(async () => {
  await t.cleanup();
});

const save = (contact: string | null) => mac.send('put', '/api/remote/push/contact', { contact });

const failed = (reason: string | null, status = 403) =>
  recordRemoteAudit(t.db, t.workspaceId, {
    action: 'notification_sent',
    device: { id: device.id, name: 'Pixel' },
    status,
    detail: { outcome: 'failed', ...(reason ? { reason } : {}) },
  });

describe('the sender contact', () => {
  it('uses the project page until the user sets one', async () => {
    const state = await mac.get('/api/remote/push/contact').expect(200);
    expect(state.body).toEqual({ contact: null, inUse: PUSH_CONTACT_DEFAULT, failures: [] });
  });

  it('saves an email as a mailto contact, and goes back to the default when cleared', async () => {
    const saved = await save('  me@example.org ').expect(200);
    expect(saved.body).toMatchObject({
      contact: 'mailto:me@example.org',
      inUse: 'mailto:me@example.org',
    });
    const cleared = await save('').expect(200);
    expect(cleared.body).toMatchObject({ contact: null, inUse: PUSH_CONTACT_DEFAULT });
  });

  it('refuses a contact Apple would refuse, or one that names the tailnet', async () => {
    const local = await save('me@mac.local').expect(400);
    expect(local.body.error).toMatch(/public domain/);
    const tailnet = await save('https://mac.tail1234.ts.net').expect(400);
    expect(tailnet.body.error).toMatch(/tailnet/);
    await save('ftp://example.org').expect(400);
    const state = await mac.get('/api/remote/push/contact').expect(200);
    expect(state.body.contact).toBeNull();
  });

  it('says a long email is too long rather than malformed', async () => {
    const email = `${'a'.repeat(186)}@example.org`;
    expect(email).toHaveLength(198);
    const refused = await save(email).expect(400);
    expect(refused.body.error).toBe('Use a contact of at most 200 characters.');
  });

  it('records a change in the remote activity without the contact', async () => {
    await save('me@example.org').expect(200);
    const { rows } = await t.db.query<{ detail: object }>(
      "SELECT detail FROM remote_audit WHERE action = 'push_contact_changed'",
    );
    expect(rows).toEqual([{ detail: { set: true } }]);
  });

  it('is a Mac route', async () => {
    const phone = remoteClient(app, device.cookie);
    await phone.get('/api/remote/push/contact').expect(403);
    await phone.send('put', '/api/remote/push/contact', { contact: null }).expect(403);
  });
});

describe('a delivery failure', () => {
  it('shows the last failure of each device with its reason', async () => {
    await failed('BadJwtToken');
    const state = await mac.get('/api/remote/push/contact').expect(200);
    expect(state.body.failures).toEqual([
      { at: expect.any(String), deviceName: 'Pixel', status: 403, reason: 'BadJwtToken' },
    ]);
  });

  it('clears once a later notification to that device is delivered', async () => {
    await failed('BadJwtToken');
    await recordRemoteAudit(t.db, t.workspaceId, {
      action: 'notification_sent',
      device: { id: device.id, name: 'Pixel' },
      detail: { outcome: 'sent' },
    });
    const state = await mac.get('/api/remote/push/contact').expect(200);
    expect(state.body.failures).toEqual([]);
  });

  it('clears when the contact changes', async () => {
    await failed('BadJwtToken');
    await save('me@example.org').expect(200);
    const state = await mac.get('/api/remote/push/contact').expect(200);
    expect(state.body.failures).toEqual([]);
  });
});
