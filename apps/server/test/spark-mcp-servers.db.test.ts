import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SPARK_ACTION_OPTION, type Approval } from '@spark-outpost/contracts';
import { getApproval } from '../src/persistence/approvals.ts';
import { effectiveFor } from '../src/mcp/effective.ts';
import { loadUserMcp } from '../src/mcp/launch.ts';
import { saveManualServer } from '../src/mcp/save.ts';
import { readMcpSecrets } from '../src/mcp/secrets.ts';
import {
  GLOBAL_KEY,
  enablementsFor,
  getUserMcp,
  listUserMcp,
  setUserEnablement,
} from '../src/mcp/store.ts';
import { memorySecretStore, type SecretStore } from '../src/setup/secrets.ts';
import {
  answerCard,
  confirmCard,
  recordedHooks,
  startSparkTools,
  type RecordedHooks,
  type SparkToolsHarness,
} from './spark-mcp-support.ts';
import { createTestDb, startChat, type TestDb } from './support.ts';

let t: TestDb;
let secrets: SecretStore;
let recorded: RecordedHooks;
let tools: SparkToolsHarness;
let conversationId: string;
let runId: string;

const FILES = {
  name: 'files',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp/notes'],
};

beforeEach(async () => {
  t = await createTestDb();
  secrets = memorySecretStore();
  ({ conversationId, runId } = await startChat(t, 'Look into the notes'));
  recorded = recordedHooks();
  tools = await startSparkTools(t, { conversationId, runId, actions: recorded.hooks }, { secrets });
});

afterEach(async () => {
  recorded.stop();
  await tools.close();
  await t.cleanup();
});

const servers = () => listUserMcp(t.db, t.workspaceId);

async function seed(body: {
  name: string;
  env?: Record<string, string>;
  command?: string;
}): Promise<string> {
  return saveManualServer({ db: t.db, workspaceId: t.workspaceId, secrets }, null, {
    name: body.name,
    transport: 'stdio',
    command: body.command ?? 'node',
    args: ['server.js'],
    url: null,
    env: body.env ?? {},
    headers: {},
  });
}

async function configAudit(): Promise<{ target: string; enabled: boolean; detail: unknown }[]> {
  const { rows } = await t.db.query<{ target: string; enabled: boolean; detail: unknown }>(
    `SELECT target, enabled, detail FROM agent_config_audit
      WHERE workspace_id = $1 AND subject = 'mcp' ORDER BY created_at, id`,
    [t.workspaceId],
  );
  return rows;
}

async function asMode(mode: string): Promise<void> {
  await t.db.query(`UPDATE runs SET provider = 'claude', used_mode = $2 WHERE id = $1`, [
    runId,
    mode,
  ]);
}

describe('spark_add_mcp_server', () => {
  it('adds nothing until the user confirms a card showing the exact command', async () => {
    const waiting = await tools.call('spark_add_mcp_server', FILES);
    expect(waiting.json()).toMatchObject({ outcome: 'waiting_for_user' });
    expect(await servers()).toEqual([]);

    const card = await confirmCard(t);
    expect(card).toMatchObject({ kind: 'spark_action', title: 'Add this MCP server? files' });
    expect(card.payload.sparkAction).toMatchObject({
      action: 'add_mcp_server',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp/notes'],
      needsValues: [],
      turnOn: 'this_chat',
    });
    expect(card.payload.sparkResult).toMatchObject({
      state: 'done',
      message: expect.stringContaining('npx -y @modelcontextprotocol/server-filesystem /tmp/notes'),
      output: { name: 'files', turnedOn: 'this_chat', note: expect.stringContaining('new agent') },
    });

    const [server] = await servers();
    expect(server).toMatchObject({ name: 'files', source: 'user', transport: 'stdio' });
    expect((await loadUserMcp(t.db, conversationId, [])).map((entry) => entry.name)).toEqual([
      'files',
    ]);
    const rows = await enablementsFor(t.db, [server!.id]);
    expect(effectiveFor(server!, rows, null, []).enabled).toBe(false);
    expect(JSON.stringify(recorded.audited)).toContain('spark/add_mcp_server');
    expect(await configAudit()).toEqual([
      expect.objectContaining({
        target: 'files',
        enabled: true,
        detail: expect.objectContaining({ change: 'added', by: 'agent', command: 'npx', runId }),
      }),
      expect.objectContaining({ detail: expect.objectContaining({ scope: 'chat' }) }),
    ]);
  });

  it('leaves the list alone when the user declines', async () => {
    await tools.call('spark_add_mcp_server', FILES);
    const card = await answerCard(t, SPARK_ACTION_OPTION.decline);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect((await getApproval(t.db, card.id))?.status).toBe('denied');
    expect(await servers()).toEqual([]);
  });

  it('saves secret names as placeholders, keeps the server off and never stores a value', async () => {
    await tools.call('spark_add_mcp_server', {
      name: 'github',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: ['GITHUB_TOKEN'],
      turnOn: 'all_chats',
    });
    const card = await confirmCard(t);

    expect(card.payload.sparkAction).toMatchObject({
      envNames: ['GITHUB_TOKEN'],
      needsValues: ['GITHUB_TOKEN'],
      turnOn: 'off',
    });
    expect(card.payload.sparkResult).toMatchObject({
      message: expect.stringContaining('Fill GITHUB_TOKEN in Settings → MCP servers'),
      output: {
        needsValues: ['GITHUB_TOKEN'],
        fillValuesIn: 'Settings → MCP servers',
        turnedOn: 'off',
      },
    });
    const [server] = await servers();
    expect(server!.config).toMatchObject({ envNames: ['GITHUB_TOKEN'], secretNames: [] });
    expect(await readMcpSecrets(secrets, server!.id)).toEqual({ env: {}, headers: {} });
    expect(await loadUserMcp(t.db, conversationId, [])).toEqual([]);

    const listed = (await tools.call('spark_mcp_servers')).json<{ servers: { name: string }[] }>();
    expect(listed.servers).toEqual([
      expect.objectContaining({
        name: 'github',
        canUpdate: true,
        command: 'npx',
        envNames: ['GITHUB_TOKEN'],
        valuesMissing: ['GITHUB_TOKEN'],
        on: { allChats: false, thisChat: false, projects: [] },
      }),
    ]);
    const refused = await tools.call('spark_switch_mcp_server', { server: 'github', state: 'on' });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain('still needs a value for GITHUB_TOKEN');
  });

  it('refuses secret values, NAME=value pairs, bad commands and duplicates before any card', async () => {
    const token = await tools.call('spark_add_mcp_server', {
      ...FILES,
      args: ['--token=abc12345xyz'],
    });
    expect(token.isError).toBe(true);
    expect(token.text).toContain('looks like it holds a secret');
    expect(token.text).not.toContain('abc12345xyz');

    const pair = await tools.call('spark_add_mcp_server', { ...FILES, env: ['TOKEN=abc12345xyz'] });
    expect(pair.isError).toBe(true);
    expect(pair.text).toContain('names only');

    const line = await tools.call('spark_add_mcp_server', { ...FILES, command: 'npx -y thing' });
    expect(line.text).toContain('each argument in args');

    const url = await tools.call('spark_add_mcp_server', { name: 'docs', transport: 'http' });
    expect(url.text).toContain('http:// or https://');

    await seed({ name: 'files' });
    const twice = await tools.call('spark_add_mcp_server', FILES);
    expect(twice.text).toContain('already an MCP server named files');

    const { rowCount } = await t.db.query(`SELECT 1 FROM approvals WHERE kind = 'spark_action'`);
    expect(rowCount).toBe(0);
  });

  it('adds at once in Bypass permissions and returns the result', async () => {
    await asMode('bypassPermissions');
    const result = await tools.call('spark_add_mcp_server', { ...FILES, turnOn: 'all_chats' });

    expect(result.json()).toMatchObject({
      outcome: 'done',
      name: 'files',
      turnedOn: 'all_chats',
      note: expect.stringContaining('new agent sessions'),
    });
    const [server] = await servers();
    const rows = await enablementsFor(t.db, [server!.id]);
    expect(effectiveFor(server!, rows, null, []).enabled).toBe(true);
    const { rows: cards } = await t.db.query<{ status: string; decided_by: string }>(
      `SELECT status, decided_by FROM approvals WHERE kind = 'spark_action'`,
    );
    expect(cards).toEqual([{ status: 'allowed', decided_by: 'level' }]);
    expect(JSON.stringify(recorded.audited)).toContain('"outcome":"performing"');
  });

  it('acts in Accept edits only when the user asked for it', async () => {
    await asMode('acceptEdits');
    const unasked = await tools.call('spark_add_mcp_server', FILES);
    expect(unasked.json()).toMatchObject({ outcome: 'waiting_for_user' });
    await answerCard(t, SPARK_ACTION_OPTION.decline);

    const asked = await startChat(t, 'Please add the notes MCP server');
    await t.db.query(
      `UPDATE runs SET provider = 'claude', used_mode = 'acceptEdits' WHERE id = $1`,
      [asked.runId],
    );
    const other = recordedHooks();
    const direct = await startSparkTools(
      t,
      { conversationId: asked.conversationId, runId: asked.runId, actions: other.hooks },
      { secrets },
    );
    try {
      const result = await direct.call('spark_add_mcp_server', { ...FILES, name: 'notes' });
      expect(result.json()).toMatchObject({ outcome: 'done', name: 'notes' });
    } finally {
      other.stop();
      await direct.close();
    }
  });
});

describe('spark_update_mcp_server', () => {
  it('changes only what was passed, keeps saved values and stays on where it was on', async () => {
    const id = await seed({ name: 'api', env: { API_KEY: 'value-in-keychain', OLD: 'drop-me' } });
    const before = (await getUserMcp(t.db, t.workspaceId, id))!;
    await setUserEnablement(t.db, t.workspaceId, before, {
      scope: 'global',
      scopeKey: GLOBAL_KEY,
      enabled: true,
    });

    await tools.call('spark_update_mcp_server', {
      server: 'api',
      args: ['server.js', '--port', '4100'],
      env: ['API_KEY', 'REGION'],
    });
    const card = await confirmCard(t);

    expect(card.title).toBe('Change this MCP server? api');
    expect(card.payload.sparkAction).toMatchObject({
      action: 'update_mcp_server',
      changed: ['args', 'envNames'],
      command: 'node',
      needsValues: ['REGION'],
      keepsOn: true,
    });
    const after = (await getUserMcp(t.db, t.workspaceId, id))!;
    expect(after.config).toMatchObject({
      args: ['server.js', '--port', '4100'],
      envNames: ['API_KEY', 'REGION'],
      secretNames: ['API_KEY'],
    });
    expect(after.fingerprint).not.toBe(before.fingerprint);
    expect(await readMcpSecrets(secrets, id)).toEqual({
      env: { API_KEY: 'value-in-keychain' },
      headers: {},
    });
    const rows = await enablementsFor(t.db, [id]);
    expect(effectiveFor(after, rows, null, [])).toMatchObject({ enabled: true, changed: false });
    expect(JSON.stringify(card.payload)).not.toContain('value-in-keychain');
    expect((await configAudit()).at(-1)).toMatchObject({
      target: 'api',
      detail: { change: 'updated', by: 'agent', envNames: ['API_KEY', 'REGION'] },
    });
  });

  it('says so when nothing would change and refuses imported servers', async () => {
    await seed({ name: 'api' });
    const same = await tools.call('spark_update_mcp_server', { server: 'api', command: 'node' });
    expect(same.text).toContain('Nothing would change');

    await t.db.query(`UPDATE mcp_servers SET source = 'imported:cursor' WHERE name = 'api'`);
    const imported = await tools.call('spark_update_mcp_server', { server: 'api', command: 'bun' });
    expect(imported.isError).toBe(true);
    expect(imported.text).toContain('imported from another app');
    const missing = await tools.call('spark_update_mcp_server', { server: 'nope', command: 'x' });
    expect(missing.text).toContain('No MCP server called nope. MCP servers: api.');
  });
});

describe('spark_switch_mcp_server and spark_remove_mcp_server', () => {
  it('turns a server on for all chats, off for this chat, then clears the chat setting', async () => {
    const id = await seed({ name: 'api' });
    const state = async () => {
      const server = (await getUserMcp(t.db, t.workspaceId, id))!;
      const rows = await enablementsFor(t.db, [id]);
      return {
        all: effectiveFor(server, rows, null, []).enabled,
        chat: effectiveFor(server, rows, conversationId, []).enabled,
      };
    };

    await tools.call('spark_switch_mcp_server', { server: 'api', state: 'on', place: 'all_chats' });
    const on = await confirmCard(t);
    expect(on.payload.sparkAction).toMatchObject({ command: 'node', args: ['server.js'] });
    expect(on.payload.sparkResult?.message).toBe('Turned api on for all chats.');
    expect(await state()).toEqual({ all: true, chat: true });

    await tools.call('spark_switch_mcp_server', { server: 'api', state: 'off' });
    await confirmCard(t);
    expect(await state()).toEqual({ all: true, chat: false });

    await tools.call('spark_switch_mcp_server', { server: 'api', state: 'inherit' });
    await confirmCard(t);
    expect(await state()).toEqual({ all: true, chat: true });
  });

  it('will not turn on a server that changed after the card was shown', async () => {
    const id = await seed({ name: 'api' });
    await tools.call('spark_switch_mcp_server', { server: 'api', state: 'on', place: 'all_chats' });
    const server = (await getUserMcp(t.db, t.workspaceId, id))!;
    await saveManualServer({ db: t.db, workspaceId: t.workspaceId, secrets }, server, {
      name: 'api',
      transport: 'stdio',
      command: 'sh',
      args: ['-c', 'something else'],
      url: null,
      env: {},
      headers: {},
    });

    const card: Approval = await confirmCard(t);
    expect(card.payload.sparkResult).toMatchObject({
      state: 'failed',
      message: expect.stringContaining('changed after this was asked'),
    });
    expect(await enablementsFor(t.db, [id])).toEqual([]);
  });

  it('removes a server with its saved values after the user confirms', async () => {
    const id = await seed({ name: 'api', env: { API_KEY: 'value-in-keychain' } });
    await tools.call('spark_remove_mcp_server', { server: 'api' });
    expect(await servers()).toHaveLength(1);

    const card = await confirmCard(t);
    expect(card.title).toBe('Remove this MCP server? api');
    expect(card.payload.sparkResult?.message).toBe('Removed the MCP server api.');
    expect(await servers()).toEqual([]);
    expect(await readMcpSecrets(secrets, id)).toEqual({ env: {}, headers: {} });
    expect((await configAudit()).at(-1)).toMatchObject({
      target: 'api',
      enabled: false,
      detail: { change: 'removed', by: 'agent' },
    });
  });
});

describe('MCP tools in a read-only session', () => {
  it('lists servers but offers no action tools', async () => {
    await seed({ name: 'api' });
    const readOnly = await startSparkTools(t, { readOnly: true }, { secrets });
    try {
      const listed = (await readOnly.call('spark_mcp_servers')).json<{
        servers: { name: string }[];
      }>();
      expect(listed.servers.map((server) => server.name)).toEqual(['api']);
      expect((await readOnly.call('spark_add_mcp_server', FILES)).isError).toBe(true);
    } finally {
      await readOnly.close();
    }
  });
});
