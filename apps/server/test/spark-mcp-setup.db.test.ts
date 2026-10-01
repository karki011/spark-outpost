import { execFileSync } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { saveManualServer } from '../src/mcp/save.ts';
import { saveConnection, updateProfile } from '../src/persistence/setup.ts';
import { createProject } from '../src/projects/projects.ts';
import { memorySecretStore, type SecretStore } from '../src/setup/secrets.ts';
import { saveConnection as saveTicketConnection } from '../src/tickets/connections.ts';
import { LINEAR_KEY } from './fake-linear.ts';
import { connectClient, startSparkTools, type SparkToolsHarness } from './spark-mcp-support.ts';
import { connectCliProvider, createTestDb, startChat, type TestDb } from './support.ts';
import { startTicketStubs, type TicketStubs } from './ticket-support.ts';

const ZAI_KEY = 'zai-key-0123456789abcdefABCDEF';
const MCP_SECRET = 'xoxb-1234567890-abcdefghijklmnop';

let t: TestDb;
let secrets: SecretStore;
let stubs: TicketStubs;
let tools: SparkToolsHarness | null = null;

beforeEach(async () => {
  t = await createTestDb();
  secrets = memorySecretStore();
  stubs = await startTicketStubs();
});

afterEach(async () => {
  await tools?.close();
  tools = null;
  await stubs.close();
  await t.cleanup();
});

async function open(conversationId: string | null = null) {
  tools = await startSparkTools(
    t,
    { conversationId },
    { secrets, linearApiUrl: stubs.linearUrl, serverSpendCapUsd: 25 },
  );
  return tools;
}

describe('spark_providers', () => {
  it('lists connected providers, how they connect, the default and recent problems, never keys', async () => {
    await connectCliProvider(t, 'claude');
    await secrets.set('zai', ZAI_KEY);
    await saveConnection(t.db, t.workspaceId, 'zai', {
      method: 'api_key',
      detail: 'Key ending CDEF',
      summary: '',
      models: [],
    });
    await updateProfile(t.db, t.workspaceId, { defaultProvider: 'claude' });
    const { runId } = await startChat(t, 'hello');
    await t.db.query(
      `UPDATE runs SET provider = 'codex', status = 'failed', error = 'Codex is not signed in',
         finished_at = now() WHERE id = $1`,
      [runId],
    );

    const result = await (await open()).call('spark_providers');

    expect(result.isError).toBe(false);
    expect(result.text).not.toContain(ZAI_KEY);
    const body = result.json<{
      defaultProvider: string;
      providers: { id: string; connected: boolean; method?: string; default: boolean }[];
      problemsLast24h: { provider: string; message: string }[];
    }>();
    expect(body.defaultProvider).toBe('claude');
    const byId = new Map(body.providers.map((provider) => [provider.id, provider]));
    expect(byId.get('claude')).toMatchObject({
      connected: true,
      default: true,
      method: 'local CLI login',
    });
    expect(byId.get('zai')).toMatchObject({
      connected: true,
      method: 'API key (stored in keychain)',
    });
    expect(byId.get('codex')).toMatchObject({ connected: false });
    expect(body.problemsLast24h).toEqual([
      expect.objectContaining({ provider: 'codex', message: expect.stringContaining('signed in') }),
    ]);
  });
});

describe('spark_connectors', () => {
  it('reports Linear connected, Jira and GitHub not, and MCP servers without their secrets', async () => {
    await saveTicketConnection(
      { db: t.db, workspaceId: t.workspaceId, secrets, fetch, linearApiUrl: stubs.linearUrl },
      { source: 'linear', apiKey: LINEAR_KEY },
    );
    await saveManualServer({ db: t.db, workspaceId: t.workspaceId, secrets }, null, {
      name: 'slack',
      transport: 'http',
      command: null,
      args: [],
      url: 'https://slack.example/mcp',
      env: {},
      headers: { Authorization: `Bearer ${MCP_SECRET}` },
    });

    const result = await (await open()).call('spark_connectors');

    expect(result.text).not.toContain(LINEAR_KEY);
    expect(result.text).not.toContain(MCP_SECRET);
    const body = result.json<{
      github: { connected: boolean };
      tickets: { source: string; connected: boolean; account?: string }[];
      mcpServers: { name: string; transport: string; onForAllChats: boolean }[];
    }>();
    expect(body.github.connected).toBe(false);
    expect(body.tickets).toEqual([
      expect.objectContaining({ source: 'Linear', connected: true, account: 'alex@example.test' }),
      { source: 'Jira', connected: false },
    ]);
    expect(body.mcpServers).toEqual([
      expect.objectContaining({ name: 'slack', transport: 'http' }),
    ]);
  });
});

describe('spark_settings', () => {
  it('returns the autonomy level, personality, caps and brief time', async () => {
    await updateProfile(t.db, t.workspaceId, {
      defaultLevel: 'balanced',
      personality: 'facts',
      spendCapUsd: 5,
      morningBriefTime: '08:30',
    });

    const body = (await (await open()).call('spark_settings')).json<Record<string, unknown>>();

    expect(body).toMatchObject({
      defaultAutonomy: 'Review each step',
      personality: 'facts',
      spendCapPerTaskUsd: 5,
      serverSpendCapUsd: 25,
      morningBrief: { on: true, time: '08:30' },
    });
    expect(body.autonomyLevels).toHaveLength(3);
  });
});

describe('spark_projects and spark_map', () => {
  let root: string;

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'spark-mcp-project-')));
    await writeFile(join(root, 'README.md'), 'hi\n');
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
    git('init', '-q', '-b', 'main');
    git('add', '.');
    git('-c', 'user.email=t@example.com', '-c', 'user.name=T', 'commit', '-qm', 'init');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('lists projects with default branch, where chats work and Map status', async () => {
    const { project } = await createProject(t.db, t.workspaceId, root);

    const body = (await (await open()).call('spark_projects')).json<{
      items: Record<string, unknown>[];
    }>();

    expect(body.items).toEqual([
      expect.objectContaining({
        id: project.id,
        name: project.name,
        defaultBranch: 'main',
        whereSparkWorks: expect.stringMatching(/^In my files/),
        buildersAtOnce: { value: 3, note: expect.stringContaining('Builders at once') },
        map: 'not built',
      }),
    ]);
  });

  it('shows one Builder at a time when the project or the server runs pieces in order', async () => {
    const { project } = await createProject(t.db, t.workspaceId, root);
    await t.db.query(`UPDATE projects SET piece_slots = 1, work_place = 'worktree' WHERE id = $1`, [
      project.id,
    ]);

    const inOrder = (await (await open()).call('spark_projects')).json<{
      items: Record<string, unknown>[];
    }>();
    expect(inOrder.items[0]).toMatchObject({
      whereSparkWorks: expect.stringMatching(/^Each chat in its own worktree/),
      buildersAtOnce: { value: 1, note: expect.stringContaining('one at a time') },
    });

    await tools?.close();
    await t.db.query('UPDATE projects SET piece_slots = 2 WHERE id = $1', [project.id]);
    tools = await startSparkTools(t, {}, { parallelBuilders: false });
    const serverInOrder = (await tools.call('spark_projects')).json<{
      items: Record<string, unknown>[];
    }>();
    expect(serverInOrder.items[0]).toMatchObject({
      buildersAtOnce: { value: 1, note: expect.stringContaining('COORDINATOR_MODE') },
    });
  });

  it('explains a missing project and a chat without one', async () => {
    await createProject(t.db, t.workspaceId, root);
    const harness = await open();

    const unknown = await harness.call('spark_map', { project: 'nope' });
    const none = await harness.call('spark_map');

    expect(unknown).toMatchObject({ isError: true });
    expect(unknown.text).toContain('No project called nope');
    expect(none.text).toContain('This chat has no project');
  });
});

describe('the Spark tools server', () => {
  it('marks only the confirmed actions as not read-only and stops answering once the grant is revoked', async () => {
    const harness = await startSparkTools(t);
    tools = harness;
    const grant = harness.host.grant({
      workspaceId: t.workspaceId,
      conversationId: null,
      runId: null,
    });
    const client = await connectClient(grant);
    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name).sort()).toEqual([
      'spark_activity',
      'spark_analytics',
      'spark_assign_ticket',
      'spark_attention',
      'spark_audit',
      'spark_brief',
      'spark_chat',
      'spark_chat_history',
      'spark_chats',
      'spark_comment_ticket',
      'spark_connectors',
      'spark_create_ticket',
      'spark_guide',
      'spark_laws',
      'spark_map',
      'spark_models',
      'spark_open_pr',
      'spark_pr',
      'spark_pr_follow_up',
      'spark_pr_follow_up_round',
      'spark_projects',
      'spark_providers',
      'spark_pull_requests',
      'spark_run',
      'spark_settings',
      'spark_spend',
      'spark_task',
      'spark_terminals',
      'spark_tickets',
      'spark_transition_ticket',
    ]);
    const acting = listed.tools.filter((tool) => tool.annotations?.readOnlyHint === false);
    expect(acting.map((tool) => tool.name).sort()).toEqual([
      'spark_assign_ticket',
      'spark_comment_ticket',
      'spark_create_ticket',
      'spark_open_pr',
      'spark_pr_follow_up_round',
      'spark_transition_ticket',
    ]);
    for (const tool of listed.tools) {
      expect(tool.annotations).toMatchObject({ destructiveHint: false });
    }
    grant.revoke();
    await expect(client.listTools()).rejects.toThrow();
    await client.close().catch(() => undefined);
  });
});
