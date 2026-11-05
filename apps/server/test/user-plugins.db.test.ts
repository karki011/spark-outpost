import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserPlugin, UserPluginsResponse } from '@spark-outpost/contracts';
import { loadUserPlugins } from '../src/agent-config/user-plugins/launch.ts';
import { createTestApp, LOCAL_HEADERS, ORIGIN } from './app-support.ts';
import { createTestDb, type TestDb } from './support.ts';
import { EGM_LIKE, installPlugin, writeInstalled, writeTree } from './user-plugin-fixture.ts';

let t: TestDb;
let app: ReturnType<typeof createTestApp>;
let base: string;
let config: string;
let toolsPath: string;

beforeAll(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'spark-user-plugins-db-')));
  config = join(base, 'claude');
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

beforeEach(async () => {
  await rm(config, { recursive: true, force: true });
  const egmPath = await installPlugin(config, 'egm@google', EGM_LIKE);
  toolsPath = await installPlugin(config, 'tools@m', {
    '.claude-plugin/plugin.json': JSON.stringify({ name: 'tools' }),
    'commands/hi.md': 'Say hi with `${CLAUDE_PLUGIN_ROOT}/scripts/run.sh`.\n',
    'scripts/run.sh': 'echo hi\n',
  });
  await writeInstalled(config, [
    { key: 'egm@google', installPath: egmPath },
    { key: 'tools@m', installPath: toolsPath },
  ]);
  vi.stubEnv('CLAUDE_CONFIG_DIR', config);
  t = await createTestDb();
  app = createTestApp(t);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await t.cleanup();
});

const list = async () =>
  (
    (await request(app).get('/api/user-plugins').set(LOCAL_HEADERS).expect(200))
      .body as UserPluginsResponse
  ).plugins;
const find = async (key: string) => (await list()).find((plugin) => plugin.key === key)!;
const put = (key: string, body: object) =>
  request(app)
    .put(`/api/user-plugins/${encodeURIComponent(key)}`)
    .set(LOCAL_HEADERS)
    .set('Origin', ORIGIN)
    .send(body);

const enable = (plugin: UserPlugin, confirmFindings = false) =>
  put(plugin.key, { enabled: true, fingerprint: plugin.fingerprint, confirmFindings });

async function audits() {
  const { rows } = await t.db.query<{ target: string; enabled: boolean }>(
    `SELECT target, enabled FROM agent_config_audit WHERE subject = 'user-plugin' ORDER BY created_at`,
  );
  return rows.map((row) => [row.target, row.enabled]);
}

describe('user plugins API', () => {
  it('lists installed plugins, off and scanned', async () => {
    const plugins = await list();
    expect(plugins.map((plugin) => [plugin.key, plugin.scan.status, plugin.enabled])).toEqual([
      ['egm@google', 'clean', false],
      ['tools@m', 'review', false],
    ]);
    expect(plugins[0]).toMatchObject({ name: 'egm', skills: 2, agents: 2, loadable: true });
    expect(plugins.map((plugin) => plugin.commandNames)).toEqual([
      ['egm:egm-draft', 'egm:egm-review'],
      ['tools:hi'],
    ]);
  });

  it('turns a clean plugin on for the reviewed fingerprint only, and audits it', async () => {
    const egm = await find('egm@google');
    await put(egm.key, { enabled: true, fingerprint: 'stale' }).expect(409);
    await enable(egm).expect(200);
    expect(await find('egm@google')).toMatchObject({ enabled: true, changed: false });
    expect((await loadUserPlugins(t.db, t.workspaceId, config)).map((p) => p.key)).toEqual([
      'egm@google',
    ]);
    await put(egm.key, { enabled: false, fingerprint: '' }).expect(200);
    expect(await loadUserPlugins(t.db, t.workspaceId, config)).toEqual([]);
    expect(await audits()).toEqual([
      ['egm@google', true],
      ['egm@google', false],
    ]);
  });

  it('needs findings confirmed before turning on a plugin to review', async () => {
    const tools = await find('tools@m');
    const refused = await enable(tools).expect(409);
    expect(refused.body).toEqual({ error: expect.stringMatching(/findings to review/) });
    expect(await audits()).toEqual([]);
    await enable(tools, true).expect(200);
    expect((await find('tools@m')).enabled).toBe(true);
  });

  it('stops loading a plugin that changed until it is turned on again', async () => {
    await enable(await find('tools@m'), true).expect(200);
    await writeTree(toolsPath, { 'commands/hi.md': 'Say hello.\n' });
    const changed = await find('tools@m');
    expect(changed).toMatchObject({ enabled: true, changed: true });
    expect(await loadUserPlugins(t.db, t.workspaceId, config)).toEqual([]);
    await enable(changed, true).expect(200);
    expect(await find('tools@m')).toMatchObject({ enabled: true, changed: false });
  });

  it('refuses a plugin that is not installed', async () => {
    await put('gone@m', { enabled: true, fingerprint: 'x' }).expect(400);
  });
});
