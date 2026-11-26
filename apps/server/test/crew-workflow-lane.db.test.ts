import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { workflowTriggersSchema, type WorkflowRun } from '@spark-outpost/contracts';
import { WORKFLOW_NOTE_HEADER } from '../src/crew-flows/step-prompt.ts';
import { chatTurnActive } from '../src/crew-flows/chat-started.ts';
import { saveTriggers } from '../src/crew-flows/trigger-records.ts';
import { ensureChatWorkFolder } from '../src/chat-files/folders.ts';
import { listChatFiles } from '../src/chat-files/store.ts';
import { startFreshChat } from '../src/compaction/fresh-chat.ts';
import { recordReport, reportNoteOfTurn } from '../src/crew-flows/run-records.ts';
import { addToQueue } from '../src/persistence/chat-queue.ts';
import { drainQueue, sendNow } from '../src/workflow/queue-drain.ts';
import { loadRunInput } from '../src/workflow/run-input.ts';
import type { Worker } from '../src/workflow/worker.ts';
import { createTestApp, localClient } from './app-support.ts';
import { newSpark, step, useWorkflowsDir } from './crew-workflow-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';
import { gitRepo, openChat, removeRepo, repliesOf } from './turn-support.ts';
import { connectAgents, startTurnWorker } from './turn-worker.ts';

let t: TestDb;
let root: string;
let chat: string;
let client: ReturnType<typeof localClient>;
let harness: Worker | null = null;
let dropWorkflows: () => Promise<void>;
const target = async () => ({ provider: 'claude' });

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  dropWorkflows = await useWorkflowsDir();
  await connectAgents(t);
  client = localClient(createTestApp(t, { fixedRunProvider: null }));
  chat = await openChat(t, { root });
});

afterEach(async () => {
  await harness?.stop();
  harness = null;
  await t.cleanup();
  await removeRepo(root);
  await dropWorkflows();
});

async function review(lastPrompt = '') {
  const pip = await newSpark(t, 'Pip');
  const workflow = {
    id: 'review',
    name: 'Review',
    steps: [
      step('read', pip.id, { prompt: 'working notes nobody needs' }),
      step('verdict', pip.id, { dependsOn: ['read'], prompt: lastPrompt }),
    ],
  };
  await client.send('put', '/api/workflows/review', { workflow, baseHash: null }).expect(200);
}

async function startInChat(): Promise<WorkflowRun> {
  const started = await client
    .send('post', '/api/workflows/review/runs', { conversationId: chat })
    .expect(201);
  return started.body as WorkflowRun;
}

const settled = (id: string) =>
  eventually(async () => {
    const run = (await client.get(`/api/workflow-runs/${id}`)).body as WorkflowRun;
    return run.status === 'running' ? null : run;
  }, 60_000);

async function recordOf(id: string): Promise<WorkflowRun> {
  return (await client.get(`/api/workflow-runs/${id}`)).body as WorkflowRun;
}

const reportIdOf = (id: string) =>
  eventually(async () => (await recordOf(id)).reportMessageId, 30_000);

async function turnsOf() {
  const { rows } = await t.db.query<{ id: string; source: string | null; status: string }>(
    `SELECT id, source, status FROM runs WHERE conversation_id = $1 AND parent_run_id IS NULL
     ORDER BY created_at, id`,
    [chat],
  );
  return rows;
}

async function turnFor(messageId: string) {
  const { rows } = await t.db.query<{ id: string; status: string }>(
    'SELECT id, status FROM runs WHERE user_message_id = $1 AND parent_run_id IS NULL',
    [messageId],
  );
  return rows[0] ?? null;
}

describe('a workflow run outside the chat’s turns', { timeout: 120_000 }, () => {
  it('leaves the chat free: a message sent or queued meanwhile starts its own turn', async () => {
    await review();
    const run = await startInChat();

    expect((await loadRunInput(t.db, run.runId!)).workflowLane).toBe(true);
    const now = randomUUID();
    expect(await sendNow(t.db, chat, { id: now, content: 'A question' }, target)).toBe('sent');
    expect((await turnFor(now))?.id).not.toBe(run.runId);
    const steered = await t.db.query('SELECT 1 FROM member_messages WHERE run_id = $1', [
      run.runId,
    ]);
    expect(steered.rowCount).toBe(0);

    await t.db.query("UPDATE runs SET status = 'succeeded' WHERE id = $1", [
      (await turnFor(now))!.id,
    ]);
    const queued = randomUUID();
    await addToQueue(t.db, chat, { id: queued, content: 'Queued' });
    expect(await drainQueue(t.db, chat, target)).toBe('sent');
    expect(await turnFor(queued)).not.toBeNull();
  });

  it('sends its report to the chat’s agent as a later turn, with the last step’s reply only', async () => {
    await review('the verdict text');
    harness = startTurnWorker(t);
    const run = await startInChat();

    const done = await settled(run.id);
    expect(done.status).toBe('succeeded');
    const laneLine = await eventually(async () => (await repliesOf(t, done.runId!))[0]);
    expect(laneLine).toBe('The Review workflow finished. Its report goes to this chat’s agent.');

    const reportId = await reportIdOf(run.id);
    const report = await eventually(async () => {
      const turn = await turnFor(reportId);
      return turn?.status === 'succeeded' ? turn : null;
    }, 60_000);
    const turns = await turnsOf();
    expect(turns.map((turn) => turn.source)).toEqual(['workflow', 'workflow']);
    expect((await loadRunInput(t.db, report.id)).workflowLane).toBe(false);
    const [reply] = await repliesOf(t, report.id);
    const prompt = reply!.slice(reply!.indexOf('prompt='));
    expect(prompt).toContain('Report from the Review workflow.');
    expect(prompt).toContain(WORKFLOW_NOTE_HEADER);
    expect(prompt).toMatch(/verdict \(Pip[^)]*\) replied:/);
    expect(prompt).toMatch(/read \(Pip[^)]*\) finished; a later step used its reply/);
    expect(prompt).not.toContain('working notes nobody needs');
    expect(prompt).toContain('does not push or open a pull request');
  });

  it('sends nothing when a quiet workflow finishes with no findings', async () => {
    await review();
    await saveTriggers(t.db, t.workspaceId, 'review', {
      ...workflowTriggersSchema.parse({}),
      quietWhenClean: true,
    });
    harness = startTurnWorker(t);
    const run = await startInChat();

    const done = await settled(run.id);
    expect(done.status).toBe('succeeded');
    const line = await eventually(async () => (await repliesOf(t, done.runId!))[0]);
    expect(line).toContain('with no findings, so nothing was sent to this chat’s agent');
    expect((await recordOf(run.id)).reportMessageId ?? null).toBeNull();
    expect(await turnsOf()).toHaveLength(1);
    const queue = await t.db.query('SELECT 1 FROM chat_queue WHERE conversation_id = $1', [chat]);
    expect(queue.rowCount).toBe(0);
  });

  it('sends only the finding lines when a quiet workflow finds something', async () => {
    await review('[High] the token is written to the log');
    await saveTriggers(t.db, t.workspaceId, 'review', {
      ...workflowTriggersSchema.parse({}),
      quietWhenClean: true,
    });
    harness = startTurnWorker(t);
    const run = await startInChat();

    await settled(run.id);
    const reportId = await reportIdOf(run.id);
    const report = await eventually(async () => {
      const turn = await turnFor(reportId);
      return turn?.status === 'succeeded' ? turn : null;
    }, 60_000);
    const [reply] = await repliesOf(t, report.id);
    const prompt = reply!.slice(reply!.indexOf('prompt='));
    expect(prompt).toContain('[High] the token is written to the log (verdict)');
    expect(prompt).toContain('Only the findings are here');
    expect(prompt).not.toContain('replied:');
  });

  it('waits behind the chat’s own turn instead of joining it', async () => {
    await review('the verdict text');
    const busy = randomUUID();
    expect(await sendNow(t.db, chat, { id: busy, content: 'Long work' }, target)).toBe('sent');
    const run = await startInChat();
    await t.db.query("UPDATE jobs SET available_at = now() + interval '1 hour' WHERE run_id = $1", [
      (await turnFor(busy))!.id,
    ]);
    harness = startTurnWorker(t);

    await settled(run.id);
    const reportId = await reportIdOf(run.id);
    const { rows } = await t.db.query<{ origin: string }>(
      'SELECT origin FROM chat_queue WHERE id = $1',
      [reportId],
    );
    expect(rows[0]?.origin).toBe('workflow');
    expect(await turnFor(reportId)).toBeNull();
  });

  it('keeps the report with its turn when the turn moves to a fresh chat', async () => {
    await review();
    const run = await startInChat();
    const messageId = randomUUID();
    await recordReport(t.db, run.id, { messageId, note: 'the stored report' });
    expect(
      await sendNow(t.db, chat, { id: messageId, content: 'Report', origin: 'workflow' }, target),
    ).toBe('sent');
    const reportTurn = (await turnFor(messageId))!;

    const fresh = await startFreshChat(
      t.db,
      {
        identity: { threadId: chat, runId: reportTurn.id },
        workspaceId: t.workspaceId,
        userRequest: 'Report',
        workflowStarted: true,
      },
      'summary',
      null,
    );

    const { rows } = await t.db.query<{ id: string; source: string | null }>(
      'SELECT id, source FROM runs WHERE conversation_id = $1 AND parent_run_id IS NULL',
      [fresh.id],
    );
    expect(rows[0]?.source).toBe('workflow');
    expect(await reportNoteOfTurn(t.db, rows[0]!.id)).toBe('the stored report');
    expect(await reportNoteOfTurn(t.db, reportTurn.id)).toBeNull();
  });

  it('does not hold a chat-started trigger behind a background workflow run', async () => {
    await review();
    await startInChat();
    expect(await chatTurnActive(t.db, chat)).toBe(false);
  });

  it('keeps a file left in a no-project chat’s folder with the background run', async () => {
    await review();
    await saveTriggers(t.db, t.workspaceId, 'review', {
      ...workflowTriggersSchema.parse({}),
      quietWhenClean: true,
    });
    const base = await realpath(await mkdtemp(join(tmpdir(), 'spark-lane-files-')));
    try {
      chat = await openChat(t);
      await writeFile(join(await ensureChatWorkFolder(base, chat), 'notes.md'), 'from a step');
      harness = startTurnWorker(t, { chatFolders: base });
      const run = await startInChat();

      await settled(run.id);
      await eventually(async () => (await repliesOf(t, run.runId!))[0]);
      expect(await turnsOf()).toHaveLength(1);
      const files = await listChatFiles(t.db, chat);
      expect(files.map((file) => [file.path, file.runId])).toEqual([['notes.md', run.runId]]);
    } finally {
      await harness?.stop();
      harness = null;
      await rm(base, { recursive: true, force: true });
    }
  });
});
