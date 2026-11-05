import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/api/app.ts';
import { testAppOptions } from './app-support.ts';
import { ArtifactHarness } from './artifact-support.ts';
import { pairDevice, remoteClient, setSwitches, turnRemoteOn } from './remote-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let h: ArtifactHarness;
let app: ReturnType<typeof createApp>;
let phone: ReturnType<typeof remoteClient>;
let id: string;

beforeEach(async () => {
  t = await createTestDb();
  h = await ArtifactHarness.create(t);
  await h.start('auto');
  const { facts } = await h.call({
    action: 'publish',
    title: 'Page',
    kind: 'html',
    content: '<p>hi</p>',
  });
  id = facts.id as string;
  app = createApp({ ...testAppOptions(t), chatFolders: h.base });
  await turnRemoteOn(app);
  const device = await pairDevice(app);
  phone = remoteClient(app, device.cookie);
});

afterEach(async () => {
  await h.close();
  await t.cleanup();
});

const view = () => phone.get(`/api/artifacts/${id}/versions/1/view`);
const page = () => phone.get(`/api/artifacts/${id}/versions/1/page`);
const file = () => phone.get(`/api/artifacts/${id}/versions/1/file`);

describe('artifacts on a paired device', { timeout: 30_000 }, () => {
  it('are refused while Open artifacts is off, which is the default', async () => {
    const session = await phone.get('/api/remote/session').expect(200);
    expect(session.body.switches.artifacts).toBe(false);
    await view().expect(403);
    await page().expect(403);
  });

  it('can be viewed with the switch on, in the same sandbox', async () => {
    await setSwitches(app, { artifacts: true });
    const shown = await view().expect(200);
    expect(shown.body.text).toBe('<p>hi</p>');
    const served = await page().expect(200);
    expect(served.headers['content-security-policy']).toContain('sandbox allow-scripts');
    expect(served.headers['content-security-policy']).toContain("connect-src 'none'");
  });

  it('never download, whatever the switch says', async () => {
    await file().expect(403);
    await setSwitches(app, { artifacts: true });
    await file().expect(403);
  });

  it('still open on a device when the Mac’s artifact page server could not start', async () => {
    const down = createApp({ ...testAppOptions(t), chatFolders: h.base, artifactOriginDown: true });
    await turnRemoteOn(down);
    const device = remoteClient(down, (await pairDevice(down)).cookie);
    await setSwitches(down, { artifacts: true });

    const shown = await device.get(`/api/artifacts/${id}/versions/1/view`).expect(200);
    expect(shown.body.viewUrl).toBeNull();
    const served = await device.get(`/api/artifacts/${id}/versions/1/page`).expect(200);
    expect(served.text).toContain('<p>hi</p>');
  });

  it('cannot turn the switch on from the device', async () => {
    await phone.send('patch', '/api/remote/switches', { artifacts: true }).expect(403);
  });
});
