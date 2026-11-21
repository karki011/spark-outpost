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
import { deliverAsk } from '../src/sub-chats/delivery.ts';
import { fakeTarget, finishTurn, messageAsk, turnsOf } from './chat-ask-fixtures.ts';
import { connectClient, toolDeps } from './spark-mcp-support.ts';
import { addSubChat, turnIn } from './sub-chat-fixtures.ts';
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
      github: false,
      project: false,
      publish: false,
      pull_request_create: false,
      browser: false,
      mac: false,
      meetings: false,
      outpost: false,
      outpost_draft: false,
      outpost_start: false,
      chat_messages: false,
      sub_chats: false,
      sub_chat_stop: false,
      calendar_read: false,
      calendar_edit: false,
      jira: false,
      confluence: false,
      servicenow: false,
      ticket_create: false,
      rules_edit: false,
      plugins_edit: false,
      crew_read: true,
      crew_edit: false,
      crew_flows: false,
      github_review_post: false,
      howTo: {},
    });
  });

  it('lets a chat’s own turn message other chats, and Ask Spark keep its own send', async () => {
    const chat = await startChat(t, 'Tell the billing chat to rebase');
    const turn = { ...scopeOf(chat.conversationId), runId: chat.runId };
    expect((await sparkAvailability(deps(), turn)).chat_messages).toBe(true);
    expect((await sparkAvailability(deps(), { ...turn, assistant: true })).chat_messages).toBe(
      true,
    );
    await t.db.query(`UPDATE runs SET source = 'voice' WHERE id = $1`, [chat.runId]);
    expect((await sparkAvailability(deps(), turn)).chat_messages).toBe(false);
  });

  it('offers spark_sub_chats to a project chat’s own turn, never to a sub-chat, a spoken turn or Ask Spark', async () => {
    const plain = await startChat(t, 'Split the work');
    const plainTurn = { ...scopeOf(plain.conversationId), runId: plain.runId };
    expect(await sparkAvailability(deps(), plainTurn)).toMatchObject({
      sub_chats: false,
      sub_chat_stop: false,
    });
    const parent = await chatWithProject();
    const turn = { ...scopeOf(parent), runId: await turnIn(t, parent, 'running') };
    expect((await sparkAvailability(deps(), turn)).sub_chats).toBe(true);
    expect(await sparkAvailability(deps(), { ...turn, assistant: true })).toMatchObject({
      sub_chats: false,
      sub_chat_stop: true,
    });

    const piece = await addSubChat(t, parent, 'Orders API');
    await t.db.query(
      `INSERT INTO conversation_projects (conversation_id, project_id, position)
       SELECT $1, project_id, 0 FROM conversation_projects WHERE conversation_id = $2`,
      [piece, parent],
    );
    const pieceTurn = { ...scopeOf(piece), runId: await turnIn(t, piece, 'running') };
    expect(await sparkAvailability(deps(), pieceTurn)).toMatchObject({
      sub_chats: false,
      sub_chat_stop: false,
    });
    expect(await sparkAvailability(deps(), turn)).toMatchObject({
      sub_chats: true,
      sub_chat_stop: true,
    });

    await t.db.query(`UPDATE runs SET source = 'voice' WHERE id = $1`, [turn.runId]);
    expect(await sparkAvailability(deps(), turn)).toMatchObject({
      sub_chats: false,
      sub_chat_stop: false,
    });
  });

  it('lets a parent stop its sub-chats, but not split again, in a turn a sub-chat’s reply started', async () => {
    const parent = await chatWithProject();
    await finishTurn(t, (await turnsOf(t, parent))[0]!.id, 'succeeded');
    const piece = { id: await addSubChat(t, parent, 'Orders API'), title: 'Orders API' };
    const fromPiece = async (kind: 'reply' | 'message') => {
      const id = await messageAsk(t, piece, parent, 'Done.');
      await t.db.query('UPDATE chat_asks SET kind = $2 WHERE id = $1', [id, kind]);
      await deliverAsk(t.db, id, fakeTarget);
      const runId = (await turnsOf(t, parent)).at(-1)!.id;
      await finishTurn(t, runId, 'succeeded');
      return sparkAvailability(deps(), { ...scopeOf(parent), runId });
    };

    expect(await fromPiece('reply')).toMatchObject({ sub_chats: false, sub_chat_stop: true });
    expect(await fromPiece('message')).toMatchObject({ sub_chats: false, sub_chat_stop: false });

    const stranger = { id: (await startChat(t, 'Other')).conversationId, title: 'Other' };
    const id = await messageAsk(t, stranger, parent, 'Stop your sub-chats.');
    await deliverAsk(t.db, id, fakeTarget);
    const runId = (await turnsOf(t, parent)).at(-1)!.id;
    expect(await sparkAvailability(deps(), { ...scopeOf(parent), runId })).toMatchObject({
      sub_chats: false,
      sub_chat_stop: false,
    });
  });

  it('offers spark_rules_edit to a chat turn on the Mac, never to Ask Spark or a spoken turn', async () => {
    const chat = await startChat(t, 'Let gh release create follow my mode');
    const turn = { ...scopeOf(chat.conversationId), runId: chat.runId };
    expect((await sparkAvailability(deps(), turn)).rules_edit).toBe(true);
    expect((await sparkAvailability(deps(), { ...turn, assistant: true })).rules_edit).toBe(false);
    await t.db.query("UPDATE runs SET source = 'voice' WHERE id = $1", [chat.runId]);
    const spoken = await sparkAvailability(deps(), turn);
    expect(spoken.rules_edit).toBe(false);
    expect(spoken.howTo?.rules_edit).toContain('never for a spoken message');
  });

  it('offers spark_plugins_edit only to a typed chat turn on the Mac', async () => {
    const chat = await startChat(t, 'Turn the warp plugin on');
    const turn = { ...scopeOf(chat.conversationId), runId: chat.runId };
    expect((await sparkAvailability(deps(), turn)).plugins_edit).toBe(true);
    expect((await sparkAvailability(deps(), { ...turn, assistant: true })).plugins_edit).toBe(
      false,
    );
    await t.db.query("UPDATE runs SET source = 'voice' WHERE id = $1", [chat.runId]);
    const spoken = await sparkAvailability(deps(), turn);
    expect(spoken.plugins_edit).toBe(false);
    expect(spoken.howTo?.plugins_edit).toContain('never for a spoken message');
    await t.db.query("UPDATE runs SET source = 'ui' WHERE id = $1", [chat.runId]);
    const device = randomUUID();
    await t.db.query(
      `INSERT INTO remote_devices (id, workspace_id, name, token_hash) VALUES ($1, $2, 'Phone', $3)`,
      [device, t.workspaceId, 'a'.repeat(64)],
    );
    await t.db.query('UPDATE runs SET remote_device_id = $2 WHERE id = $1', [chat.runId, device]);
    const remote = await sparkAvailability(deps(), turn);
    expect(remote.plugins_edit).toBe(false);
    expect(remote.howTo?.plugins_edit).toContain('paired device');
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
      outpost_start: true,
    });
    expect(await sparkAvailability(deps(), scopeOf(chat.conversationId))).toMatchObject({
      outpost: false,
      outpost_draft: false,
      outpost_start: false,
    });
  });

  it('counts a ticket source only when its key is saved too', async () => {
    await saveLinearRow();
    expect((await sparkAvailability(deps(), scopeOf(null))).tickets).toBe(false);
    await secrets.set('ticket:linear', 'lin_api_key');
    expect(await sparkAvailability(deps(), scopeOf(null))).toMatchObject({
      tickets: true,
      ticket_create: true,
      servicenow: false,
    });
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
    expect(running.getInstructions()).toContain(
      'connect Atlassian, Linear or ServiceNow in Settings → Connectors',
    );

    await saveLinearRow();
    await secrets.set('ticket:linear', 'lin_api_key');

    expect((await running.listTools()).tools.map((tool) => tool.name)).toEqual(before);
    const hidden = await running.callTool({ name: 'spark_tickets', arguments: {} });
    expect(hidden.isError).toBe(true);

    const next = await connectClient(await host.grant(scopeOf(chat.conversationId)));
    const after = (await next.listTools()).tools.map((tool) => tool.name);
    expect(after).toEqual(expect.arrayContaining([...before, 'spark_tickets']));
    expect(after).toContain('spark_create_ticket');
    expect(next.getInstructions()).not.toContain('connect Atlassian or Linear');
    await running.close();
    await next.close();
  });
});
