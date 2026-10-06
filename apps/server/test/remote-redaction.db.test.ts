import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, localClient } from './app-support.ts';
import { connectProviders } from './orchestration-support.ts';
import { pairDevice, remoteClient, turnRemoteOn } from './remote-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let app: ReturnType<typeof createTestApp>;
let phone: ReturnType<typeof remoteClient>;
let root: string;

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'spark-remote-redaction-')));
  await mkdir(join(root, '.git'));
  await writeFile(
    join(root, '.git', 'config'),
    '[remote "origin"]\n\turl = https://example.test\n',
  );
  await writeFile(join(root, 'README.md'), 'hello\n');
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

beforeEach(async () => {
  t = await createTestDb();
  app = createTestApp(t);
  await turnRemoteOn(app);
  phone = remoteClient(app, (await pairDevice(app)).cookie);
});

afterEach(async () => {
  await t.cleanup();
});

describe('what a phone is not shown', () => {
  it('reads project files but not git internals, which the Mac still can', async () => {
    const linked = await localClient(app)
      .send('post', '/api/projects', { rootPath: root })
      .expect(201);
    const file = `/api/projects/${linked.body.id}/file`;
    await phone.get(`${file}?path=README.md`).expect(200);
    await phone.get(`${file}?path=.git/config`).expect(403);
    await phone.get(`${file}?path=.GIT/config`).expect(403);
    await phone
      .send('post', `/api/projects/${linked.body.id}/attachments`, { path: '.git/config' })
      .expect(403);
    expect((await localClient(app).get(`${file}?path=.git/config`)).status).not.toBe(403);
  });

  it('shortens a saved key to its last four characters', async () => {
    await connectProviders(t);
    await t.db.query(
      `UPDATE provider_connections SET detail = 'sk-abcd…wxyz' WHERE workspace_id = $1`,
      [t.workspaceId],
    );
    const details = (body: { providers: { connection: { detail: string | null } | null }[] }) =>
      body.providers.flatMap((provider) => provider.connection?.detail ?? []);
    const onMac = details((await localClient(app).get('/api/setup').expect(200)).body);
    const onPhone = details((await phone.get('/api/setup').expect(200)).body);
    expect(onMac).toEqual(['sk-abcd…wxyz', 'sk-abcd…wxyz']);
    expect(onPhone).toEqual(['…wxyz', '…wxyz']);
  });
});
