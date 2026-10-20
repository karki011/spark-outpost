import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ApprovalPayload } from '@spark-outpost/contracts';
import { ensureAssistantChat } from '../src/companion/assistant.ts';
import { ASK_SPARK_REFUSALS } from '../src/spark-mcp/actions/ask-spark-limits.ts';
import { getApproval, insertApproval } from '../src/persistence/approvals.ts';
import { addToQueue } from '../src/persistence/chat-queue.ts';
import { createProject } from '../src/projects/projects.ts';
import { publishReason } from '../src/workflow/publish-step-reason.ts';
import { loadRunInput } from '../src/workflow/run-input.ts';
import {
  cardResult,
  confirmCard,
  pendingCard,
  recordedHooks,
  startSparkTools,
  type RecordedHooks,
  type SparkToolsHarness,
} from './spark-mcp-support.ts';
import { createTestApp, localClient } from './app-support.ts';
import { connectCliProvider, createTestDb, eventually, startChat, type TestDb } from './support.ts';

let t: TestDb;
let recorded: RecordedHooks;
let tools: SparkToolsHarness | null = null;
let assistant: string;
let askRun: string;

const PLAIN_OPTIONS = [
  { optionId: 'allow', name: 'Allow once', kind: 'allow_once' as const },
  { optionId: 'reject', name: 'Deny', kind: 'reject_once' as const },
];

beforeEach(async () => {
  t = await createTestDb();
  await connectCliProvider(t, 'claude');
  await t.db.query(
    `INSERT INTO profiles (workspace_id, display_name, default_provider, onboarding_completed_at)
     VALUES ($1, 'Test User', 'claude', now())`,
    [t.workspaceId],
  );
  assistant = await ensureAssistantChat(t.db, t.workspaceId);
  askRun = await assistantRun('Do something for me');
  recorded = recordedHooks();
});

afterEach(async () => {
  recorded.stop();
  await tools?.close();
  tools = null;
  await t.cleanup();
});

async function assistantRun(question: string, source = 'ui'): Promise<string> {
  const messageId = randomUUID();
  const runId = randomUUID();
  await t.db.query(
    `INSERT INTO messages (id, conversation_id, role, content) VALUES ($1, $2, 'user', $3)`,
    [messageId, assistant, question],
  );
  await t.db.query(
    `INSERT INTO runs (id, conversation_id, user_message_id, provider, status, source)
     VALUES ($1, $2, $3, 'claude', 'running', $4)`,
    [runId, assistant, messageId, source],
  );
  return runId;
}

async function setActs(acts: 'act' | 'manual') {
  await t.db.query('UPDATE profiles SET assistant_acts = $2 WHERE workspace_id = $1', [
    t.workspaceId,
    acts,
  ]);
}

async function open(runId = askRun) {
  tools = await startSparkTools(t, {
    conversationId: assistant,
    runId,
    readOnly: true,
    assistant: true,
    actions: recorded.hooks,
  });
  return tools;
}

async function card(runId: string, payload: Partial<ApprovalPayload> = {}) {
  return insertApproval(t.db, {
    runId,
    toolCallId: `call-${randomUUID()}`,
    rpcId: null,
    kind: 'execute',
    title: 'Run pnpm deploy',
    payload: {
      command: 'pnpm deploy',
      cwd: null,
      paths: [],
      diffs: [],
      truncated: false,
      ...payload,
    },
    options: PLAIN_OPTIONS,
    reason: null,
  });
}

async function runsOf(conversationId: string) {
  return eventually(async () => {
    const { rows } = await t.db.query<{ id: string; source: string; content: string }>(
      `SELECT r.id, r.source, m.content FROM runs r JOIN messages m ON m.id = r.user_message_id
       WHERE r.conversation_id = $1`,
      [conversationId],
    );
    return rows.length > 0 ? rows : null;
  }, 10_000);
}

describe('Ask Spark acts', () => {
  it('in Manual shows a card first, and starts the chat only after Do it', async () => {
    const project = await createProject(t.db, t.workspaceId, process.cwd());
    const harness = await open();
    const result = await harness.call('spark_start_chat', {
      project: project.project.name,
      task: 'Add a CONTRIBUTING file',
    });
    expect(result.json()).toMatchObject({ outcome: 'waiting_for_user' });
    const pending = await pendingCard(t);
    expect(pending.title).toBe(`Start a chat in ${project.project.name}: Add a CONTRIBUTING file`);
    expect(pending.options.map((option) => option.name)).toEqual(['Do it', 'Don’t']);
    const before = await t.db.query('SELECT 1 FROM conversations WHERE id <> $1', [assistant]);
    expect(before.rowCount).toBe(0);

    const done = await confirmCard(t);
    expect(done.payload.sparkResult?.state).toBe('done');
    expect(done.payload.sparkResult?.message).toBe(
      `Started a new chat in ${project.project.name}.`,
    );
    const started = done.payload.sparkResult?.output?.conversationId as string;
    const [run] = (await runsOf(started))!;
    expect(run).toMatchObject({ source: 'assistant', content: 'Add a CONTRIBUTING file' });
    const audit = recorded.audited.map((entry) => JSON.stringify(entry));
    expect(
      audit.some((line) => line.includes('spark/ask_spark') && line.includes('Ask Spark')),
    ).toBe(true);
  });

  it('in Act stops, archives, pauses and resumes at once and says what it did', async () => {
    await setActs('act');
    const { conversationId, runId } = await startChat(t, 'Build the thing');
    await t.db.query(`UPDATE runs SET status = 'running' WHERE id = $1`, [runId]);
    const harness = await open();

    const stopped = await harness.call('spark_stop_chat', { chat: conversationId });
    expect(stopped.json()).toMatchObject({
      outcome: 'done',
      message: 'Stopped “Build the thing”.',
    });
    const { rows } = await t.db.query<{ asked: Date | null }>(
      'SELECT cancel_requested_at AS asked FROM runs WHERE id = $1',
      [runId],
    );
    expect(rows[0]?.asked).not.toBeNull();

    const paused = await harness.call('spark_pause', { paused: true });
    expect(paused.json()).toMatchObject({ outcome: 'done', message: 'Paused Spark.' });
    const resumed = await harness.call('spark_pause', { paused: false });
    expect(resumed.json()).toMatchObject({ outcome: 'done', message: 'Resumed Spark.' });

    const archived = await harness.call('spark_archive_chat', { chat: conversationId });
    expect(archived.json()).toMatchObject({ outcome: 'done' });
    const chat = await t.db.query<{ archived: Date | null }>(
      'SELECT archived_at AS archived FROM conversations WHERE id = $1',
      [conversationId],
    );
    expect(chat.rows[0]?.archived).not.toBeNull();
  });

  it('sends a message that never counts as the user asking to publish', async () => {
    await setActs('act');
    const { conversationId, runId } = await startChat(t, 'First');
    await t.db.query(`UPDATE runs SET status = 'succeeded' WHERE id = $1`, [runId]);
    const harness = await open();
    const sent = await harness.call('spark_send_to_chat', {
      chat: conversationId,
      message: 'Push the branch and open a pull request',
    });
    expect(sent.json()).toMatchObject({ outcome: 'done' });
    const runs = (await runsOf(conversationId))!;
    const followUp = runs.find((run) => run.content.startsWith('Push'))!;
    expect(followUp.source).toBe('assistant');
    const input = await loadRunInput(t.db, followUp.id);
    expect(publishReason({ ...input, mode: 'do', level: 'hands-off' })).toBeNull();
    expect(publishReason({ ...input, assistantSent: false, mode: 'do', level: 'hands-off' })).toBe(
      'asked',
    );
  });

  it('in Act answers a plain card in another chat when the question asks, noting Ask Spark', async () => {
    await setActs('act');
    const { runId } = await startChat(t, 'Deploy');
    const waiting = await card(runId);
    const harness = await open(await assistantRun('Allow the deploy card'));
    const answered = await harness.call('spark_answer_card', {
      card: waiting.id,
      answer: 'allow_once',
    });
    expect(answered.json()).toMatchObject({
      outcome: 'done',
      message: 'Allowed once: Run pnpm deploy.',
    });
    const decided = await getApproval(t.db, waiting.id);
    expect(decided).toMatchObject({ status: 'allowed', note: 'Answered by Ask Spark' });
  });

  it('in Act still shows a card for an answer the question did not ask for', async () => {
    await setActs('act');
    const { runId } = await startChat(t, 'Deploy');
    const waiting = await card(runId);
    const harness = await open(await assistantRun('What is running?'));
    const result = await harness.call('spark_answer_card', {
      card: waiting.id,
      answer: 'allow_once',
    });
    expect(result.json()).toMatchObject({ outcome: 'waiting_for_user' });
    expect((await getApproval(t.db, waiting.id))?.status).toBe('pending');
  });

  it('in Manual leaves the other card alone until Do it', async () => {
    const { runId } = await startChat(t, 'Deploy');
    const waiting = await card(runId);
    const harness = await open();
    await harness.call('spark_answer_card', { card: waiting.id, answer: 'deny' });
    expect((await getApproval(t.db, waiting.id))?.status).toBe('pending');
    const { rows } = await t.db.query<{ id: string }>(
      `SELECT id FROM approvals WHERE kind = 'spark_action' AND status = 'pending'`,
    );
    await t.db.query(
      `UPDATE approvals SET status = 'allowed', decided_by = 'user',
       decision_option_id = 'confirm', decided_at = now() WHERE id = $1`,
      [rows[0]!.id],
    );
    await cardResult(t, rows[0]!.id);
    expect((await getApproval(t.db, waiting.id))?.status).toBe('denied');
  });

  it.each([
    ['a force push', { forcePush: ['main'] }, ASK_SPARK_REFUSALS.held],
    ['git hooks or config', { gitControl: ['.git/hooks/pre-push'] }, ASK_SPARK_REFUSALS.held],
    ['a secret-file send', { secretSend: ['.env'] }, ASK_SPARK_REFUSALS.held],
    ['an instruction file', { instructionFiles: ['AGENTS.md'] }, ASK_SPARK_REFUSALS.instructions],
  ])('never answers a card for %s, in any setting', async (_name, payload, refusal) => {
    await setActs('act');
    const { runId } = await startChat(t, 'Risky');
    const waiting = await card(runId, payload);
    const harness = await open();
    const answered = await harness.call('spark_answer_card', {
      card: waiting.id,
      answer: 'allow_once',
    });
    expect(answered.isError).toBe(true);
    expect(answered.text).toBe(refusal);
    expect((await getApproval(t.db, waiting.id))?.status).toBe('pending');
  });

  it('never answers its own cards or a card from a spoken question', async () => {
    await setActs('act');
    const own = await card(askRun);
    const harness = await open();
    const self = await harness.call('spark_answer_card', { card: own.id, answer: 'allow_once' });
    expect(self.text).toBe(ASK_SPARK_REFUSALS.ownCard);
    await harness.close();
    tools = null;

    const { runId } = await startChat(t, 'Deploy');
    const waiting = await card(runId);
    const spoken = await assistantRun('allow the deploy', 'voice');
    const voiced = await open(spoken);
    const answered = await voiced.call('spark_answer_card', {
      card: waiting.id,
      answer: 'allow_once',
    });
    expect(answered.text).toBe(ASK_SPARK_REFUSALS.voice);
    expect((await getApproval(t.db, waiting.id))?.status).toBe('pending');
  });

  it('from a paired device follows that device’s switches', async () => {
    await setActs('act');
    const device = randomUUID();
    await t.db.query('UPDATE runs SET remote_device_id = $2 WHERE id = $1', [askRun, device]);
    await t.db.query(
      `INSERT INTO remote_access_settings (workspace_id, can_high_risk_cards) VALUES ($1, false)
       ON CONFLICT (workspace_id) DO UPDATE SET can_high_risk_cards = false`,
      [t.workspaceId],
    );
    const { runId } = await startChat(t, 'Secrets');
    const waiting = await card(runId, { paths: ['/repo/.env'] });
    const harness = await open();
    const answered = await harness.call('spark_answer_card', {
      card: waiting.id,
      answer: 'allow_once',
    });
    expect(answered.isError).toBe(true);
    expect(answered.text).toContain('Turned off for remote control on your Mac');
    expect((await getApproval(t.db, waiting.id))?.status).toBe('pending');
  });

  it('leaves no chat or queued message behind when starting the chat fails', async () => {
    await setActs('act');
    const project = await createProject(t.db, t.workspaceId, process.cwd());
    await t.db.query('DELETE FROM provider_connections WHERE workspace_id = $1', [t.workspaceId]);
    const harness = await open();
    const result = await harness.call('spark_start_chat', {
      project: project.project.name,
      task: 'Add a CONTRIBUTING file',
    });
    expect(result.isError).toBe(true);
    const chats = await t.db.query('SELECT 1 FROM conversations WHERE id <> $1', [assistant]);
    expect(chats.rowCount).toBe(0);
    const queued = await t.db.query('SELECT 1 FROM chat_queue');
    expect(queued.rowCount).toBe(0);
  });

  it('keeps a queued Ask Spark message its own through Send now, and never steers with it', async () => {
    const { conversationId, runId } = await startChat(t, 'Busy');
    await t.db.query(`UPDATE runs SET status = 'running' WHERE id = $1`, [runId]);
    const item = randomUUID();
    await addToQueue(t.db, conversationId, { id: item, content: 'Open a PR', origin: 'assistant' });
    const api = localClient(createTestApp(t, { fixedRunProvider: null }));
    const steer = await api.send(
      'post',
      `/api/conversations/${conversationId}/queue/${item}/send-now`,
    );
    expect(steer.status).toBe(409);

    await t.db.query(`UPDATE runs SET status = 'succeeded' WHERE id = $1`, [runId]);
    const sent = await api.send(
      'post',
      `/api/conversations/${conversationId}/queue/${item}/send-now`,
    );
    expect(sent.status).toBe(202);
    const { rows } = await t.db.query<{ source: string }>(
      'SELECT source FROM runs WHERE user_message_id = $1',
      [item],
    );
    expect(rows[0]?.source).toBe('assistant');
  });

  it('marks a spoken question so its turn can tell it came from voice', async () => {
    await t.db.query(`UPDATE runs SET status = 'succeeded' WHERE id = $1`, [askRun]);
    const api = localClient(createTestApp(t, { fixedRunProvider: null }));
    const id = randomUUID();
    const queued = await api.send('post', `/api/conversations/${assistant}/queue`, {
      id,
      content: 'Who needs me?',
      origin: 'voice',
    });
    expect(queued.status).toBe(201);
    const { rows } = await t.db.query<{ source: string }>(
      'SELECT source FROM runs WHERE user_message_id = $1',
      [id],
    );
    expect(rows[0]?.source).toBe('voice');
  });

  it('does not act on its own conversation or a Terminal session', async () => {
    await setActs('act');
    const harness = await open();
    const self = await harness.call('spark_stop_chat', { chat: assistant });
    expect(self.text).toBe(ASK_SPARK_REFUSALS.assistantChat);
    const { conversationId } = await startChat(t, 'Terminal');
    await t.db.query(`UPDATE conversations SET session_type = 'terminal' WHERE id = $1`, [
      conversationId,
    ]);
    const terminal = await harness.call('spark_send_to_chat', {
      chat: conversationId,
      message: 'hi',
    });
    expect(terminal.text).toBe(ASK_SPARK_REFUSALS.terminal);
  });
});
