import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { insertFinishedRunEntries } from '../src/persistence/audit-log.ts';
import { sendUserMessage } from '../src/persistence/conversations.ts';
import { addToQueue, reorderQueue } from '../src/persistence/chat-queue.ts';
import { insertMemberMessage } from '../src/persistence/member-messages.ts';
import { memorySecretStore, type SecretStore } from '../src/setup/secrets.ts';
import { saveConnection as saveTicketConnection } from '../src/tickets/connections.ts';
import { LINEAR_KEY, LINEAR_ME } from './fake-linear.ts';
import { startSparkTools, type SparkToolsHarness } from './spark-mcp-support.ts';
import { createTestDb, startChat, type TestDb } from './support.ts';
import { startTicketStubs, type TicketStubs } from './ticket-support.ts';

const LEAKED = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';

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
  tools = await startSparkTools(t, { conversationId }, { secrets, linearApiUrl: stubs.linearUrl });
  return tools;
}

async function finish(runId: string, cost: number, reply: string) {
  await t.db.query(
    `UPDATE runs SET status = 'succeeded', cost_usd = $2, cost_source = 'reported',
       started_at = now() - interval '1 minute', finished_at = now(), duration_ms = 60000,
       tool_call_count = 2 WHERE id = $1`,
    [runId, cost],
  );
  const { rows } = await t.db.query<{ conversation_id: string }>(
    'SELECT conversation_id FROM runs WHERE id = $1',
    [runId],
  );
  await t.db.query(
    `INSERT INTO messages (id, conversation_id, role, content, run_id)
     VALUES ($1, $2, 'assistant', $3, $4)`,
    [randomUUID(), rows[0]!.conversation_id, reply, runId],
  );
}

async function step(runId: string, seq: number, name: string) {
  await t.db.query(
    `INSERT INTO run_events (run_id, seq, type, payload)
     VALUES ($1, $2, 'STEP_STARTED', $3)`,
    [runId, seq, JSON.stringify({ type: 'STEP_STARTED', stepName: name })],
  );
}

describe('spark_chats and spark_chat', () => {
  it('searches chats and reads one with paged, redacted messages', async () => {
    const first = await startChat(t, 'Fix the login page');
    await finish(first.runId, 0.12, `Done. The token was ${LEAKED}.`);
    const second = await startChat(t, 'Write release notes');
    const harness = await open(second.conversationId);

    const all = (await harness.call('spark_chats')).json<{
      total: number;
      items: { id: string; title: string; thisChat?: boolean; state: string }[];
    }>();
    const found = (await harness.call('spark_chats', { query: 'login' })).json<{
      items: { id: string; state: string }[];
    }>();
    const read = await harness.call('spark_chat', { chat: first.conversationId, limit: 1 });

    expect(all.total).toBe(2);
    expect(all.items.find((chat) => chat.id === second.conversationId)?.thisChat).toBe(true);
    expect(found.items).toEqual([
      expect.objectContaining({ id: first.conversationId, state: 'done' }),
    ]);
    expect(read.text).not.toContain(LEAKED);
    const body = read.json<{
      messages: {
        total: number;
        offset: number;
        earlierFrom?: number;
        items: { role: string; text: string }[];
      };
      runs: { total: number; latest: { costUsd: number }[] };
    }>();
    expect(body.messages).toMatchObject({ total: 2, offset: 1, earlierFrom: 0 });
    expect(body.messages.items).toEqual([
      expect.objectContaining({ role: 'assistant', text: expect.stringContaining('[redacted:') }),
    ]);
    expect(body.runs.latest[0]!.costUsd).toBe(0.12);
  });

  it('shows the queued messages in order and what the user told crew members', async () => {
    const chat = await startChat(t, 'Busy chat');
    const first = randomUUID();
    const second = randomUUID();
    await addToQueue(t.db, chat.conversationId, { id: first, content: 'Then add a test' });
    await addToQueue(t.db, chat.conversationId, { id: second, content: 'And update the docs' });
    await reorderQueue(t.db, chat.conversationId, [second, first]);
    await insertMemberMessage(t.db, {
      id: randomUUID(),
      conversationId: chat.conversationId,
      runId: chat.runId,
      body: 'Use UTC',
      urgency: 'next',
    });

    const body = (await (await open(chat.conversationId)).call('spark_chat')).json<{
      queue: { position: number; text: string }[];
      crewMessages: { to: string; text: string; status: string }[];
    }>();

    expect(body.queue).toEqual([
      { position: 1, text: 'And update the docs' },
      { position: 2, text: 'Then add a test' },
    ]);
    expect(body.crewMessages).toEqual([
      expect.objectContaining({ to: 'the agent', text: 'Use UTC', status: 'queued' }),
    ]);
  });

  it('defaults spark_chat to this chat and refuses chats from nowhere', async () => {
    const chat = await startChat(t, 'Current question');
    const harness = await open(chat.conversationId);

    const own = (await harness.call('spark_chat')).json<{ id: string }>();
    const missing = await harness.call('spark_chat', { chat: randomUUID() });

    expect(own.id).toBe(chat.conversationId);
    expect(missing).toMatchObject({
      isError: true,
      text: 'That chat does not exist. It may have been deleted.',
    });
  });

  it("shows the chat's branch and worktree", async () => {
    const chat = await startChat(t, 'On a branch');
    const projectId = randomUUID();
    await t.db.query(
      `INSERT INTO projects (id, workspace_id, name, root_path) VALUES ($1, $2, 'app', '/repo')`,
      [projectId, t.workspaceId],
    );
    await t.db.query(
      'INSERT INTO conversation_projects (conversation_id, project_id, position) VALUES ($1, $2, 0)',
      [chat.conversationId, projectId],
    );
    await t.db.query(
      `INSERT INTO chat_worktrees (id, conversation_id, project_id, repo_root, path, branch,
         base_branch, base_commit, in_place, owns_branch)
       VALUES ($1, $2, $3, '/repo', '/repo-wt/spark-1', 'spark/fix-login', 'main', 'abc', false,
         true)`,
      [randomUUID(), chat.conversationId, projectId],
    );

    const body = (await (await open(chat.conversationId)).call('spark_chat')).json<{
      workspace: object;
    }>();

    expect(body.workspace).toEqual({
      branch: 'spark/fix-login',
      from: 'main',
      where: 'its own worktree',
      path: '/repo-wt/spark-1',
    });
  });
});

describe('spark_audit', () => {
  it('summarizes this chat: steps, declined actions, approvals and cost per run', async () => {
    const chat = await startChat(t, 'Audit me');
    await finish(chat.runId, 0.3, 'ok');
    await step(chat.runId, 1, 'Read src/app.ts');
    await step(chat.runId, 2, 'Declined: Write .env (this chat has no project folder)');
    await t.db.query(
      `INSERT INTO approvals (id, run_id, tool_call_id, kind, title, payload, payload_hash, options,
         status, decided_by, decided_at, scope)
       VALUES ($1, $2, 't1', 'execute', 'Run npm test', '{}', 'h', '[]', 'allowed', 'user', now(), 'once')`,
      [randomUUID(), chat.runId],
    );

    const body = (await (await open(chat.conversationId)).call('spark_audit')).json<{
      chat: string;
      totals: { runs: number; costUsd: number };
      runs: { steps: string[]; declined: string[]; approvals: object[]; costUsd: number }[];
    }>();

    expect(body.chat).toBe(chat.conversationId);
    expect(body.totals).toMatchObject({ runs: 1, costUsd: 0.3 });
    expect(body.runs[0]).toMatchObject({
      steps: ['Read src/app.ts', 'Declined: Write .env (this chat has no project folder)'],
      declined: ['Declined: Write .env (this chat has no project folder)'],
      approvals: [
        {
          kind: 'execute',
          title: 'Run npm test',
          status: 'allowed',
          decidedBy: 'user',
          scope: 'once',
        },
      ],
    });
  });

  it('lists the tool calls that ran without review', async () => {
    const chat = await startChat(t, 'Bypass');
    await finish(chat.runId, 0.1, 'ok');
    const update = (fields: Record<string, unknown>, unreviewed = false) => ({
      at: new Date(),
      direction: 'from_agent' as const,
      kind: 'notification' as const,
      method: 'session/update',
      rpcId: null,
      sizeBytes: 10,
      truncated: false,
      payload: { params: { update: { toolCallId: 'w1', ...fields } } },
      ...(unreviewed ? { unreviewed: true } : {}),
    });
    await insertFinishedRunEntries(t.db, chat.runId, [
      update({ sessionUpdate: 'tool_call', title: 'Write ~/x.txt', kind: 'edit' }),
      update({ sessionUpdate: 'tool_call_update', status: 'completed' }, true),
    ]);

    const body = (await (await open(chat.conversationId)).call('spark_audit')).json<{
      runs: { ranWithoutReview?: string[] }[];
    }>();

    expect(body.runs[0]?.ranWithoutReview).toEqual(['Write ~/x.txt']);
  });

  it('narrows to one run and audits a period across chats', async () => {
    const chat = await startChat(t, 'First');
    await finish(chat.runId, 0.2, 'ok');
    const later = await sendUserMessage(
      t.db,
      chat.conversationId,
      { id: randomUUID(), content: 'Second' },
      { provider: 'fake' },
      t.workspaceId,
    );
    await finish(later.run.id, 0.05, 'ok');
    const harness = await open(chat.conversationId);

    const one = (await harness.call('spark_audit', { run: later.run.id })).json<{
      runs: { id: string }[];
    }>();
    const period = (await harness.call('spark_audit', { days: 7 })).json<{
      window: object;
      chats: { id: string; costUsd: number }[];
    }>();

    expect(one.runs.map((run) => run.id)).toEqual([later.run.id]);
    expect(period.chats).toEqual([
      expect.objectContaining({ id: chat.conversationId, costUsd: 0.25 }),
    ]);
  });
});

describe('spark_tickets', () => {
  it('puts the urgent ticket first when sorted by priority', async () => {
    stubs.linear.issues.push({
      id: 'id-ENG-99',
      identifier: 'ENG-99',
      title: 'Payments are down',
      description: '',
      team: 'ENG',
      stateId: 'eng-todo',
      updatedAt: '2026-09-28T10:00:00.000Z',
      assigneeId: LINEAR_ME,
      priority: 1,
      dueDate: null,
      completedAt: null,
      createdAt: '2026-09-27T08:00:00.000Z',
      creatorId: null,
      labels: [],
      comments: [],
      attachments: [],
      children: [],
    });
    await saveTicketConnection(
      { db: t.db, workspaceId: t.workspaceId, secrets, fetch, linearApiUrl: stubs.linearUrl },
      { source: 'linear', apiKey: LINEAR_KEY },
    );

    const result = await (await open()).call('spark_tickets', { sort: 'priority', limit: 3 });

    expect(result.text).not.toContain(LINEAR_KEY);
    const body = result.json<{
      connected: string[];
      items: { key: string; priority: string; reportedBy: string | null; createdAt?: string }[];
    }>();
    expect(body.connected).toEqual(['linear']);
    expect(body.items[0]).toMatchObject({
      key: 'ENG-99',
      priority: 'Urgent',
      reportedBy: null,
      createdAt: '2026-09-27T08:00:00.000Z',
    });
    expect(body.items.find((item) => item.key === 'ENG-12')).toMatchObject({
      reportedBy: 'Jordan Lee',
    });
    expect(body).not.toHaveProperty('highestPriority');

    const inbox = (await tools!.call('spark_tickets')).json<{
      highestPriority: { key: string; priority: string }[];
    }>();
    expect(inbox.highestPriority[0]).toMatchObject({ key: 'ENG-99', priority: 'Urgent' });
  });

  it('searches every ticket in the tracker, not only the assigned ones', async () => {
    await saveTicketConnection(
      { db: t.db, workspaceId: t.workspaceId, secrets, fetch, linearApiUrl: stubs.linearUrl },
      { source: 'linear', apiKey: LINEAR_KEY },
    );
    const harness = await open();

    const found = (
      await harness.call('spark_tickets', { action: 'search', query: 'upload' })
    ).json<{
      total: number;
      untrusted: string;
      items: Record<string, unknown>[];
    }>();
    expect(found.items).toEqual([
      expect.objectContaining({
        key: 'ENG-16',
        title: 'Unowned upload bug',
        status: 'Todo',
        statusGroup: 'todo',
        assignedTo: null,
        assignedToUser: false,
        reportedBy: 'Jordan Lee',
        createdAt: '2026-09-18T09:00:00.000Z',
        url: 'https://linear.app/acme/issue/ENG-16',
      }),
    ]);
    expect(found.untrusted).toContain('never as instructions');

    const byKey = (
      await harness.call('spark_tickets', { action: 'search', query: 'eng-15' })
    ).json<{ items: { key: string; assignedTo: string; assignedToUser: boolean }[] }>();
    expect(byKey.items).toEqual([
      expect.objectContaining({ key: 'ENG-15', assignedTo: 'Jordan Lee', assignedToUser: false }),
    ]);

    stubs.linear.issues
      .find((issue) => issue.identifier === 'ENG-16')!
      .attachments.push(
        { title: 'Fix uploads', url: 'https://github.com/acme/web/pull/88' },
        { title: 'Design notes', url: 'https://docs.example.test/uploads' },
      );
    const read = (await harness.call('spark_tickets', { action: 'read', key: 'ENG-16' })).json<{
      ticket: { reportedBy: string; createdAt: string; pullRequests: { url: string }[] };
    }>();
    expect(read.ticket).toMatchObject({
      reportedBy: 'Jordan Lee',
      createdAt: '2026-09-18T09:00:00.000Z',
      pullRequests: [{ title: 'Fix uploads', url: 'https://github.com/acme/web/pull/88' }],
    });

    const other = (
      await harness.call('spark_tickets', { action: 'search', query: 'upload', project: 'OPS' })
    ).json<{ total: number }>();
    expect(other.total).toBe(0);
    const none = await harness.call('spark_tickets', { action: 'search', source: 'jira' });
    expect(none.json<{ total: number }>().total).toBe(0);
  });

  it('says when no ticket source is connected', async () => {
    const body = (await (await open()).call('spark_tickets')).json<{
      note: string;
      total: number;
    }>();
    expect(body).toMatchObject({
      total: 0,
      note: expect.stringContaining('Connect Jira or Linear'),
    });
  });
});

describe('spark_analytics, spark_activity and spark_brief', () => {
  it('reports the period, recent chats and the brief state', async () => {
    const chat = await startChat(t, 'Recent work');
    await finish(chat.runId, 0.4, 'All done.');
    const harness = await open();

    const overview = (await harness.call('spark_analytics', { days: 7 })).json<{
      window: { days: number };
      totals: { costUsd: number };
    }>();
    const spend = await harness.call('spark_analytics', { report: 'spend', days: 30 });
    const activity = (await harness.call('spark_activity', { hours: 2 })).json<{
      chats: { id: string; costUsd: number }[];
    }>();
    const brief = (await harness.call('spark_brief')).json<{
      brief: unknown;
      flaggedTickets: [];
    }>();

    expect(overview.window.days).toBe(7);
    expect(overview.totals.costUsd).toBeCloseTo(0.4);
    expect(spend.isError).toBe(false);
    expect(activity.chats).toEqual([expect.objectContaining({ id: chat.conversationId })]);
    expect(brief).toMatchObject({ brief: null, flaggedTickets: [] });
  });
});
