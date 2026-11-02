import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  holdsToConfirm,
  SPARK_ACTION_OPTION,
  type Approval,
  type PluginsEditAction,
} from '@spark-outpost/contracts';
import { PLUGIN_REVIEW_RUNNING } from '../src/agent-config/user-plugins/choice.ts';
import { startPluginReview } from '../src/agent-config/user-plugins/review-store.ts';
import { scanUserPlugins } from '../src/agent-config/user-plugins/scan.ts';
import { macOnlyCard } from '../src/remote/policy.ts';
import { ASK_SPARK_REFUSALS, cardRefusal } from '../src/spark-mcp/actions/ask-spark-limits.ts';
import { PLUGIN_CHANGED_SINCE_CARD } from '../src/spark-mcp/actions/plugins-edit-perform.ts';
import { EVERYTHING_AVAILABLE } from '../src/spark-mcp/availability.ts';
import { sparkToolsFor } from '../src/spark-mcp/server.ts';
import { PLUGINS_RUN_REFUSALS } from '../src/spark-mcp/tools/plugins-edit-tool.ts';
import {
  answerCard,
  cardResult,
  pendingCard,
  recordedHooks,
  startSparkTools,
  type RecordedHooks,
  type SparkToolsHarness,
} from './spark-mcp-support.ts';
import { createTestDb, startChat, type TestDb } from './support.ts';
import { cachePath, EGM_LIKE, installPlugin, writeInstalled } from './user-plugin-fixture.ts';

const TOOLS = {
  '.claude-plugin/plugin.json': JSON.stringify({ name: 'tools' }),
  'commands/today.md': '---\ndescription: Today\n---\nThe date is !`date +%F`.\n',
  'hooks/hooks.json': JSON.stringify({
    hooks: { Stop: [{ matcher: '*', hooks: [{ type: 'command', command: 'echo done' }] }] },
  }),
  '.mcp.json': JSON.stringify({ mcpServers: { notes: { command: 'node', args: ['notes.js'] } } }),
};

let base: string;
let config: string;
let t: TestDb;
let tools: SparkToolsHarness;
let recorded: RecordedHooks;
let chat: { conversationId: string; runId: string };

beforeAll(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'spark-plugins-edit-')));
  config = join(base, 'claude');
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

async function setRun(mode: string, source = 'ui'): Promise<void> {
  await t.db.query(
    `UPDATE runs SET provider = 'claude', agent_mode = $2, used_mode = $2, source = $3
     WHERE id = $1`,
    [chat.runId, mode, source],
  );
}

async function startTools(scope: Record<string, unknown> = {}): Promise<void> {
  tools = await startSparkTools(t, {
    conversationId: chat.conversationId,
    runId: chat.runId,
    actions: recorded.hooks,
    ...scope,
  });
}

beforeEach(async () => {
  await rm(config, { recursive: true, force: true });
  await writeInstalled(config, [
    { key: 'egm@google', installPath: await installPlugin(config, 'egm@google', EGM_LIKE) },
    { key: 'tools@m', installPath: await installPlugin(config, 'tools@m', TOOLS) },
  ]);
  vi.stubEnv('CLAUDE_CONFIG_DIR', config);
  t = await createTestDb();
  recorded = recordedHooks();
  chat = await startChat(t, 'Turn the egm plugin on');
  await setRun('bypassPermissions');
  await startTools();
});

afterEach(async () => {
  recorded.stop();
  await tools.close();
  vi.unstubAllEnvs();
  await t.cleanup();
});

async function ask(key: string, enabled = true) {
  const result = await tools.call('spark_plugins_edit', { key, enabled });
  return { ...result, facts: result.isError ? {} : result.json() };
}

async function trust(key: string) {
  const { rows } = await t.db.query<{ enabled: boolean }>(
    'SELECT enabled FROM user_plugin_trust WHERE plugin_key = $1',
    [key],
  );
  return rows[0]?.enabled ?? null;
}

const cardAction = (card: Approval) => card.payload.sparkAction as PluginsEditAction;

describe('spark_plugins_edit always asks the user', () => {
  it.each(['bypassPermissions', 'auto'])(
    'shows a card in %s and changes nothing yet',
    async (mode) => {
      await setRun(mode);
      const result = await ask('egm@google');
      expect(result.facts.outcome).toBe('waiting_for_user');
      const card = await pendingCard(t);
      expect(card.title).toBe('Turn on “egm” for Claude chats?');
      expect(card.options.map((option) => option.name)).toEqual(['Turn on', 'Don’t turn on']);
      expect(cardAction(card)).toMatchObject({ key: 'egm@google', status: 'clean', hold: false });
      expect(holdsToConfirm(card.payload)).toBe(false);
      expect(await trust('egm@google')).toBeNull();
    },
  );

  it('names the agent’s mode as the agent shows it', async () => {
    await t.db.query(
      `INSERT INTO provider_capabilities (workspace_id, provider, models, efforts, modes)
       VALUES ($1, 'claude', '[]', '[]', $2)
       ON CONFLICT (workspace_id, provider) DO UPDATE SET modes = EXCLUDED.modes`,
      [t.workspaceId, JSON.stringify([{ id: 'default', kind: 'standard', label: 'Manual' }])],
    );
    await setRun('default');
    await ask('egm@google');
    expect(cardAction(await pendingCard(t)).modeName).toBe('Manual');
  });

  it('shows hooks, inline shell and MCP servers and needs the hold for findings', async () => {
    await ask('tools@m');
    const card = await pendingCard(t);
    expect(cardAction(card)).toMatchObject({
      status: 'review',
      hold: true,
      hooks: [{ event: 'Stop', matcher: '*', command: 'echo done' }],
      inlineShell: [{ file: 'commands/today.md', line: 4, text: 'The date is !`date +%F`.' }],
      mcpServers: [{ name: 'notes', target: 'node notes.js' }],
    });
    expect(holdsToConfirm(card.payload)).toBe(true);
    expect(macOnlyCard(card.payload)).toBe(true);
    const chatRow = { id: chat.conversationId, title: 'Chat', terminal: false };
    expect(cardRefusal(card, chatRow, null)).toBe(ASK_SPARK_REFUSALS.held);
  });

  it('turns it on after Turn on and audits the chat and agent', async () => {
    await ask('egm@google');
    const card = await answerCard(t, SPARK_ACTION_OPTION.confirm);
    expect((await cardResult(t, card.id)).payload.sparkResult).toMatchObject({ state: 'done' });
    expect(await trust('egm@google')).toBe(true);
    const { rows } = await t.db.query<{ detail: Record<string, unknown> }>(
      `SELECT detail FROM agent_config_audit WHERE subject = 'user-plugin'`,
    );
    expect(rows[0]!.detail).toMatchObject({ askedBy: 'Claude', chat: chat.conversationId });
    const audits = recorded.audited as { method: string; params: { action: object } }[];
    expect(JSON.stringify(audits)).not.toContain('echo done');
  });

  it('refuses when the plugin changed between the card and the answer', async () => {
    await ask('egm@google');
    await writeFile(join(cachePath(config, 'egm@google'), 'docs/privacy.md'), 'Changed.\n');
    const card = await answerCard(t, SPARK_ACTION_OPTION.confirm);
    expect((await cardResult(t, card.id)).payload.sparkResult).toMatchObject({
      state: 'failed',
      message: PLUGIN_CHANGED_SINCE_CARD,
    });
    expect(await trust('egm@google')).toBeNull();
  });

  it('refuses while the agent review is still running', async () => {
    const egm = (await scanUserPlugins(config)).find((p) => p.installed.key === 'egm@google')!;
    const request = { pluginKey: 'egm@google', fingerprint: egm.fingerprint, prompt: 'review' };
    const model = { provider: 'claude' as const, model: null, effort: null };
    await startPluginReview(t.db, t.workspaceId, request, model);
    const result = await ask('egm@google');
    expect(result.isError).toBe(true);
    expect(result.text).toContain(PLUGIN_REVIEW_RUNNING);
  });

  it('says nothing changed for a plugin that is already off', async () => {
    expect((await ask('egm@google', false)).facts.outcome).toBe('unchanged');
  });

  it('asks again for a plugin that is on but has findings the user never confirmed', async () => {
    const plugin = (await scanUserPlugins(config)).find((p) => p.installed.key === 'tools@m')!;
    await t.db.query(
      `INSERT INTO user_plugin_trust (workspace_id, plugin_key, enabled, fingerprint, snapshot, decided_at)
       VALUES ($1, 'tools@m', true, $2, '{"findings": []}', now())`,
      [t.workspaceId, plugin.fingerprint],
    );
    expect((await ask('tools@m')).facts.outcome).toBe('waiting_for_user');
    expect(cardAction(await pendingCard(t))).toMatchObject({ key: 'tools@m', hold: true });
  });

  it('refuses a spoken run and is never offered to Ask Spark', async () => {
    await setRun('bypassPermissions', 'voice');
    const result = await ask('egm@google');
    expect(result.isError).toBe(true);
    expect(result.text).toContain(PLUGINS_RUN_REFUSALS.voice);
    const offered = sparkToolsFor({ assistant: true }, EVERYTHING_AVAILABLE);
    expect(offered.map((tool) => tool.name)).not.toContain('spark_plugins_edit');
  });
});
