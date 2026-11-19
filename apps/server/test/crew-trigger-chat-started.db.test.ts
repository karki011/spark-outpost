import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { workflowTriggersSchema, type WorkflowTriggers } from '@spark-outpost/contracts';
import { resolveRunTarget } from '../src/api/run-target.ts';
import { startWorkflowRun } from '../src/crew-flows/start-run.ts';
import {
  claimDueTriggers,
  listTriggerEvents,
  saveTriggers,
} from '../src/crew-flows/trigger-records.ts';
import { checkTriggers, STRANDED_TRIGGER_MS } from '../src/crew-flows/trigger-runner.ts';
import { sendUserMessage } from '../src/persistence/conversations.ts';
import { FLOW, runsOf, schedulerClock } from './crew-schedule-support.ts';
import { newSpark, saveFlow, step, useWorkflowsDir } from './crew-workflow-support.ts';
import { createTestDb, type TestDb } from './support.ts';
import { gitRepo, openChat, removeRepo } from './turn-support.ts';
import { connectAgents } from './turn-worker.ts';

let t: TestDb;
let root: string;
let dropWorkflows: () => Promise<void>;
let clock: ReturnType<typeof schedulerClock>;

const minutesFromNow = (minutes: number) => new Date(Date.now() + minutes * 60_000);

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  dropWorkflows = await useWorkflowsDir();
  await connectAgents(t);
  const pip = await newSpark(t, 'Pip');
  await saveFlow(t, FLOW, [step('review', pip.id)]);
  clock = schedulerClock(t, new Date());
});

afterEach(async () => {
  await t.cleanup();
  await removeRepo(root);
  await dropWorkflows();
});

const triggers = (extra: Partial<WorkflowTriggers> = {}) =>
  workflowTriggersSchema.parse({ chatStarted: true, ...extra });

const events = () => listTriggerEvents(t.db, t.workspaceId, FLOW);

type Source = Parameters<typeof sendUserMessage>[2]['source'];

async function send(
  conversationId: string,
  text: string,
  options: { id?: string; source?: Source; asTerminal?: boolean } = {},
): Promise<string> {
  const target = await resolveRunTarget({ db: t.db, workspaceId: t.workspaceId }, conversationId);
  if (options.asTerminal) {
    await t.db.query(`UPDATE conversations SET session_type = 'terminal' WHERE id = $1`, [
      conversationId,
    ]);
  }
  const sent = await sendUserMessage(
    t.db,
    conversationId,
    { id: options.id ?? randomUUID(), content: text, source: options.source },
    target,
  );
  return sent.run.id;
}

async function finishTurn(runId: string): Promise<void> {
  await t.db.query(`UPDATE runs SET status = 'succeeded', finished_at = now() WHERE id = $1`, [
    runId,
  ]);
}

async function checkAt(now: Date): Promise<void> {
  clock.set(now);
  await checkTriggers(clock.deps);
}

async function outpostPost(fromUser: boolean): Promise<string> {
  const outpostId = randomUUID();
  const postId = randomUUID();
  await t.db.query(`INSERT INTO outposts (id, workspace_id, name) VALUES ($1, $2, 'Divider')`, [
    outpostId,
    t.workspaceId,
  ]);
  await t.db.query(
    `INSERT INTO outpost_posts (id, outpost_id, kind, body, from_user, to_handle)
     VALUES ($1, $2, 'request', 'Build it.', $3, 'api')`,
    [postId, outpostId, fromUser],
  );
  return postId;
}

async function startedChat(): Promise<{ conversationId: string; runId: string }> {
  const conversationId = await openChat(t, { root });
  const runId = await send(conversationId, 'Fix the date divider.', { source: 'ui' });
  return { conversationId, runId };
}

describe('a chat starts', () => {
  it('queues one run on the first message only, never on later ones', async () => {
    await saveTriggers(t.db, t.workspaceId, FLOW, triggers());
    const conversationId = await openChat(t, { root });
    expect(await events()).toEqual([]);

    const first = await send(conversationId, 'Fix the date divider.');
    const [event, ...rest] = await events();
    expect(rest).toEqual([]);
    expect(event).toMatchObject({ kind: 'chat_started', state: 'pending', conversationId });

    await finishTurn(first);
    await checkAt(minutesFromNow(1));
    const second = await send(conversationId, 'And the header.');
    await finishTurn(second);
    await checkAt(minutesFromNow(2));
    expect((await events()).map((item) => item.state)).toEqual(['started']);
    expect(await runsOf(t)).toHaveLength(1);
  });

  it('records nothing for a sent message twice, and no second run for the same chat', async () => {
    await saveTriggers(t.db, t.workspaceId, FLOW, triggers());
    const conversationId = await openChat(t, { root });
    const id = randomUUID();
    await send(conversationId, 'Fix the date divider.', { id });
    await send(conversationId, 'Fix the date divider.', { id });
    expect(await events()).toHaveLength(1);
  });

  it('starts only after the user’s first turn ends, as a workflow message in that chat', async () => {
    await saveTriggers(t.db, t.workspaceId, FLOW, triggers());
    const chat = await startedChat();

    await checkAt(minutesFromNow(1));
    expect(await runsOf(t)).toEqual([]);
    expect((await events())[0]).toMatchObject({ state: 'pending' });

    await t.db.query(`UPDATE runs SET status = 'running' WHERE id = $1`, [chat.runId]);
    await checkAt(minutesFromNow(2));
    expect(await runsOf(t)).toEqual([]);

    await finishTurn(chat.runId);
    await checkAt(minutesFromNow(3));
    const [run] = await runsOf(t);
    expect(run).toMatchObject({ source: 'trigger', conversationId: chat.conversationId });
    const { rows } = await t.db.query<{ source: string }>('SELECT source FROM runs WHERE id = $1', [
      run!.runId,
    ]);
    expect(rows[0]!.source).toBe('workflow');
    expect((await events())[0]).toMatchObject({ state: 'started', workflowRunId: run!.id });
  });

  it('fires for a chat the user starts with a request typed in an outpost', async () => {
    await saveTriggers(t.db, t.workspaceId, FLOW, triggers());
    const member = await openChat(t, { root });
    const typed = await outpostPost(true);
    await send(member, 'Build the API slice.', { id: typed, source: 'outpost' });
    expect((await events()).map((item) => item.conversationId)).toEqual([member]);
  });

  it('is due after the workflow’s wait', async () => {
    await saveTriggers(t.db, t.workspaceId, FLOW, triggers({ debounceMinutes: 5 }));
    const before = Date.now();
    const chat = await startedChat();
    await finishTurn(chat.runId);
    const [event] = await events();
    expect(new Date(event!.dueAt).getTime()).toBeGreaterThanOrEqual(before + 5 * 60_000);

    await checkAt(minutesFromNow(4));
    expect(await runsOf(t)).toEqual([]);
    await checkAt(minutesFromNow(6));
    expect(await runsOf(t)).toHaveLength(1);
  });

  it('follows the project filter, and fires in a chat with no project only without one', async () => {
    const other = await gitRepo();
    try {
      const elsewhere = await openChat(t, { root: other });
      const { rows } = await t.db.query<{ project_id: string }>(
        'SELECT project_id FROM conversation_projects WHERE conversation_id = $1',
        [elsewhere],
      );
      await saveTriggers(t.db, t.workspaceId, FLOW, triggers({ projectId: rows[0]!.project_id }));
      await startedChat();
      const loose = await openChat(t);
      await send(loose, 'What is a monad?');
      expect(await events()).toEqual([]);

      await send(elsewhere, 'Fix the header.');
      expect((await events()).map((item) => item.conversationId)).toEqual([elsewhere]);

      await saveTriggers(t.db, t.workspaceId, FLOW, triggers());
      const another = await openChat(t);
      await send(another, 'What is a functor?');
      expect((await events()).map((item) => item.conversationId)).toContain(another);
    } finally {
      await removeRepo(other);
    }
  });

  it('does nothing while the trigger is off, and turning it off drops a waiting run', async () => {
    await saveTriggers(
      t.db,
      t.workspaceId,
      FLOW,
      triggers({ chatStarted: false, turnChanged: true }),
    );
    await startedChat();
    expect(await events()).toEqual([]);

    await saveTriggers(t.db, t.workspaceId, FLOW, triggers());
    await startedChat();
    expect(await events()).toHaveLength(1);
    await saveTriggers(
      t.db,
      t.workspaceId,
      FLOW,
      triggers({ chatStarted: false, turnChanged: true }),
    );
    expect(await events()).toEqual([]);
  });

  it('a claim left by a stopped process starts once after a restart', async () => {
    await saveTriggers(t.db, t.workspaceId, FLOW, triggers());
    const chat = await startedChat();
    await finishTurn(chat.runId);
    const [claim] = await claimDueTriggers(t.db, t.workspaceId, minutesFromNow(1));
    expect(claim).toBeDefined();

    const later = minutesFromNow(1 + (STRANDED_TRIGGER_MS + 1000) / 60_000);
    await checkAt(later);
    await checkAt(new Date(later.getTime() + STRANDED_TRIGGER_MS + 1000));
    const runs = await runsOf(t);
    expect(runs).toHaveLength(1);
    const { rows } = await t.db.query<{ user_message_id: string }>(
      'SELECT user_message_id FROM runs WHERE id = $1',
      [runs[0]!.runId],
    );
    expect(rows[0]!.user_message_id).toBe(claim!.messageId);
  });
});

describe('chats that never fire', () => {
  beforeEach(async () => {
    await saveTriggers(t.db, t.workspaceId, FLOW, triggers());
  });

  it('a chat a workflow started, the triggered run itself, and the user’s next message there', async () => {
    const chat = await startedChat();
    await finishTurn(chat.runId);
    await checkAt(minutesFromNow(1));
    expect(await runsOf(t)).toHaveLength(1);

    const run = await startWorkflowRun(clock.deps, {
      kind: 'run',
      workflowId: FLOW,
      messageId: randomUUID(),
      source: 'agent',
      conversationId: null,
      projectId: null,
      message: 'Look around.',
    });
    expect(await events()).toHaveLength(1);
    await send(run.conversationId!, 'Thanks, now fix it.');
    expect(await events()).toHaveLength(1);
  });

  it('a hidden crew chat, Ask Spark’s chat and a Terminal session', async () => {
    const crew = await openChat(t, { root });
    await t.db.query(`UPDATE conversations SET kind = 'crew' WHERE id = $1`, [crew]);
    await send(crew, 'Test this Spark.');

    const assistant = await openChat(t, { root });
    await t.db.query(
      `INSERT INTO profiles (workspace_id, assistant_conversation_id) VALUES ($1, $2)
       ON CONFLICT (workspace_id) DO UPDATE SET assistant_conversation_id = $2`,
      [t.workspaceId, assistant],
    );
    await send(assistant, 'Who needs me?');

    const terminal = await openChat(t, { root });
    await send(terminal, 'Run the tests.', { asTerminal: true });
    expect(await events()).toEqual([]);
  });

  it('a sub-chat another chat’s outpost request started, and a fresh chat continued from another', async () => {
    const sub = await openChat(t, { root });
    const lead = await outpostPost(false);
    await send(sub, 'Build the API slice.', { id: lead, source: 'outpost' });

    const original = await startedChat();
    const fresh = await openChat(t, { root });
    await t.db.query(
      `INSERT INTO compactions (id, conversation_id, method, from_conversation_id)
       VALUES ($1, $2, 'spark', $3)`,
      [randomUUID(), fresh, original.conversationId],
    );
    await send(fresh, 'Carry on with the divider.');
    expect((await events()).map((item) => item.conversationId)).toEqual([original.conversationId]);
  });

  it('a chat restored from the archive', async () => {
    const chat = await startedChat();
    await finishTurn(chat.runId);
    await checkAt(minutesFromNow(1));
    await t.db.query('UPDATE conversations SET archived_at = now() WHERE id = $1', [
      chat.conversationId,
    ]);
    await send(chat.conversationId, 'Back to this.');
    expect(await events()).toHaveLength(1);
  });
});
