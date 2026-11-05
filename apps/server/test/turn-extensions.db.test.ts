import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { scanUserPlugins } from '../src/agent-config/user-plugins/scan.ts';
import { setPluginChoice } from '../src/agent-config/user-plugins/store.ts';
import { loadTurnExtensions } from '../src/workflow/turn-extensions.ts';
import { createTestDb, type TestDb } from './support.ts';
import { EGM_LIKE, installPlugin, writeInstalled } from './user-plugin-fixture.ts';

let t: TestDb;
let base: string;
let config: string;

beforeAll(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'spark-turn-extensions-db-')));
  config = join(base, 'claude');
  const installPath = await installPlugin(config, 'egm@google', EGM_LIKE);
  await writeInstalled(config, [{ key: 'egm@google', installPath }]);
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

beforeEach(async () => {
  vi.stubEnv('CLAUDE_CONFIG_DIR', config);
  t = await createTestDb();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await t.cleanup();
});

const pluginsFor = async (provider: string, assistant = false) =>
  (
    await loadTurnExtensions(t.db, {
      provider,
      assistant,
      workspaceId: t.workspaceId,
      identity: { threadId: '00000000-0000-0000-0000-000000000000' },
    })
  ).userPlugins.map((plugin) => plugin.key);

describe('turn extensions', () => {
  it('loads enabled plugins for Claude-based turns only', async () => {
    expect(await pluginsFor('claude')).toEqual([]);
    const [egm] = await scanUserPlugins(config);
    await setPluginChoice(t.db, t.workspaceId, egm!, { enabled: true, confirmFindings: false });
    expect(await pluginsFor('claude')).toEqual(['egm@google']);
    expect(await pluginsFor('zai')).toEqual(['egm@google']);
    expect(await pluginsFor('codex')).toEqual([]);
    expect(await pluginsFor('claude', true)).toEqual([]);
  });
});
