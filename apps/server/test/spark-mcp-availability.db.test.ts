import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { saveGitHubToken } from '../src/persistence/github-tokens.ts';
import { saveSlackConnection } from '../src/persistence/slack.ts';
import { saveTicketConnection } from '../src/persistence/ticket-connections.ts';
import { memorySecretStore, type SecretStore } from '../src/setup/secrets.ts';
import { sparkAvailability } from '../src/spark-mcp/availability.ts';
import type { SparkToolDeps } from '../src/spark-mcp/deps.ts';
import { startSparkMcpHost, type SparkMcpHost } from '../src/spark-mcp/host.ts';
import { createOutpostRow } from './outpost-fixtures.ts';
import { connectClient, toolDeps } from './spark-mcp-support.ts';
import { createTestDb, startChat, type TestDb } from './support.ts';

let t: TestDb;
let secrets: SecretStore;
let host: SparkMcpHost | null = null;

beforeEach(async () => {
  t = await createTestDb();
  secrets = memorySecretStore();
});

afterEach(async () => {
  await host?.close();
  host = null;
  await t.cleanup();
});

const deps = (overrides: Partial<SparkToolDeps> = {}) => toolDeps(t, { secrets, ...overrides });

const scopeOf = (conversationId: string | null) => ({
  workspaceId: t.workspaceId,
  conversationId,
  runId: null,
});

async function saveLinearRow() {
  await saveTicketConnection(t.db, t.workspaceId, {
    source: 'linear',
    apiUrl: 'https://linear.test/graphql',
    email: null,
    account: 'Ada',
    accountId: 'user-1',
  });
}

async function saveSlackRow() {
  await saveSlackConnection(t.db, t.workspaceId, {
    teamId: 'T1',
    teamName: 'Acme',
    teamUrl: 'https://acme.slack.test/',
    botUserId: 'B1',
    botName: 'spark',
    member: null,
    userScopes: null,
  });
}

async function saveGitHubTokenRow() {
  await saveGitHubToken(t.db, t.workspaceId, {
    host: 'github.com',
    login: 'octo',
    scopes: ['repo'],
    expiresAt: null,
    repos: [],
  });
}

async function chatWithProject(): Promise<string> {
  const chat = await startChat(t, 'Fix the login page');
  const projectId = randomUUID();
  await t.db.query(
    `INSERT INTO projects (id, workspace_id, name, root_path) VALUES ($1, $2, 'app', '/repo')`,
    [projectId, t.workspaceId],
  );
  await t.db.query(
    'INSERT INTO conversation_projects (conversation_id, project_id, position) VALUES ($1, $2, 0)',
    [chat.conversationId, projectId],
  );
  return chat.conversationId;
}

const ghLoggedIn = {
  locateGh: async () => '/usr/bin/gh',
  runCommand: async () => ({ code: 0, stdout: 'Logged in to github.com account octo', stderr: '' }),
};

describe('what a Spark tools session can use', () => {
  it('finds nothing in a plain chat with nothing connected', async () => {
    const chat = await startChat(t, 'Hello');
    expect(await sparkAvailability(deps(), scopeOf(chat.conversationId))).toEqual({
      tickets: false,
      slack: false,
      pull_requests: false,
      project: false,
      publish: false,
      pull_request_create: false,
      browser: false,
      outpost: false,
      outpost_draft: false,
    });
  });

  it('offers the outpost tools to a turn of a chat that is in an outpost', async () => {
    const chat = await startChat(t, 'Build the page');
    const outpostId = await createOutpostRow(t);
    await t.db.query(
      `INSERT INTO outpost_members (outpost_id, conversation_id, handle, position)
       VALUES ($1, $2, 'web', 1)`,
      [outpostId, chat.conversationId],
    );
    const turn = { ...scopeOf(chat.conversationId), runId: chat.runId };
    expect(await sparkAvailability(deps(), turn)).toMatchObject({
      outpost: true,
      outpost_draft: true,
    });
    expect(await sparkAvailability(deps(), scopeOf(chat.conversationId))).toMatchObject({
      outpost: false,
      outpost_draft: false,
    });
  });

  it('counts a ticket source only when its key is saved too', async () => {
    await saveLinearRow();
    expect((await sparkAvailability(deps(), scopeOf(null))).tickets).toBe(false);
    await secrets.set('ticket:linear', 'lin_api_key');
    expect((await sparkAvailability(deps(), scopeOf(null))).tickets).toBe(true);
  });

  it('counts Slack only when its bot token is saved too', async () => {
    await saveSlackRow();
    expect((await sparkAvailability(deps(), scopeOf(null))).slack).toBe(false);
    await secrets.set('slack:bot', 'xoxb-test');
    expect((await sparkAvailability(deps(), scopeOf(null))).slack).toBe(true);
  });

  it('counts a project only for a chat that has one linked', async () => {
    const linked = await chatWithProject();
    const plain = await startChat(t, 'Just a question');
    expect((await sparkAvailability(deps(), scopeOf(linked))).project).toBe(true);
    expect((await sparkAvailability(deps(), scopeOf(plain.conversationId))).project).toBe(false);
    expect((await sparkAvailability(deps(), scopeOf(null))).project).toBe(false);
  });

  it('needs both a linked project and a GitHub login for pull requests', async () => {
    const linked = await chatWithProject();
    const plain = await startChat(t, 'Just a question');
    expect((await sparkAvailability(deps(), scopeOf(linked))).pull_requests).toBe(false);
    await saveGitHubTokenRow();
    expect((await sparkAvailability(deps(), scopeOf(linked))).pull_requests).toBe(false);
    await secrets.set('github', 'ghp_test');
    expect((await sparkAvailability(deps(), scopeOf(linked))).pull_requests).toBe(true);
    const inPlain = await sparkAvailability(deps(), scopeOf(plain.conversationId));
    expect(inPlain.pull_requests).toBe(false);
  });

  it('counts a logged-in gh CLI as GitHub, and a logged-out one as not', async () => {
    const linked = await chatWithProject();
    const loggedIn = await sparkAvailability(deps({ github: ghLoggedIn }), scopeOf(linked));
    expect(loggedIn.pull_requests).toBe(true);
    const loggedOut = await sparkAvailability(
      deps({
        github: { ...ghLoggedIn, runCommand: async () => ({ code: 1, stdout: '', stderr: '' }) },
      }),
      scopeOf(linked),
    );
    expect(loggedOut.pull_requests).toBe(false);
  });

  it('follows whether the host has the Browser pane', async () => {
    const withPane = deps({ browser: {} as NonNullable<SparkToolDeps['browser']> });
    expect((await sparkAvailability(withPane, scopeOf(null))).browser).toBe(true);
  });
});

describe('a running Spark tools session', () => {
  it('keeps its tools when a connector is added, and the next session gets the new ones', async () => {
    host = await startSparkMcpHost(deps());
    const chat = await startChat(t, 'Create a ticket for this');
    const running = await connectClient(await host.grant(scopeOf(chat.conversationId)));
    const before = (await running.listTools()).tools.map((tool) => tool.name);
    expect(before).not.toContain('spark_tickets');
    expect(running.getInstructions()).toContain('connect Jira or Linear in Settings → Connectors');

    await saveLinearRow();
    await secrets.set('ticket:linear', 'lin_api_key');

    expect((await running.listTools()).tools.map((tool) => tool.name)).toEqual(before);
    const hidden = await running.callTool({ name: 'spark_tickets', arguments: {} });
    expect(hidden.isError).toBe(true);

    const next = await connectClient(await host.grant(scopeOf(chat.conversationId)));
    const after = (await next.listTools()).tools.map((tool) => tool.name);
    expect(after).toEqual(expect.arrayContaining([...before, 'spark_tickets']));
    expect(after).toContain('spark_create_ticket');
    expect(next.getInstructions()).not.toContain('connect Jira or Linear');
    await running.close();
    await next.close();
  });
});
