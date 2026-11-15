import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { workflowTriggersSchema, type WorkflowTriggers } from '@spark-outpost/contracts';
import {
  claimDueTriggers,
  listTriggerEvents,
  saveTriggers,
} from '../src/crew-flows/trigger-records.ts';
import { noteEndedTurn, seedPullMarks } from '../src/crew-flows/trigger-events.ts';
import { checkTriggers, STRANDED_TRIGGER_MS } from '../src/crew-flows/trigger-runner.ts';
import { userText } from '../src/outposts/user-asked.ts';
import { setSparkPaused } from '../src/persistence/spark-pause.ts';
import { loadRunInput } from '../src/workflow/run-input.ts';
import { at, finishRun, FLOW, runsOf, schedulerClock } from './crew-schedule-support.ts';
import { newSpark, saveFlow, step, useWorkflowsDir } from './crew-workflow-support.ts';
import { createTestDb, type TestDb } from './support.ts';
import { gitRepo, openChat, removeRepo, sendMessage } from './turn-support.ts';
import { connectAgents } from './turn-worker.ts';

let t: TestDb;
let root: string;
let dropWorkflows: () => Promise<void>;
let clock: ReturnType<typeof schedulerClock>;

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  dropWorkflows = await useWorkflowsDir();
  await connectAgents(t);
  const pip = await newSpark(t, 'Pip');
  await saveFlow(t, FLOW, [step('review', pip.id)]);
  clock = schedulerClock(t, at(9, 0));
});

afterEach(async () => {
  await t.cleanup();
  await removeRepo(root);
  await dropWorkflows();
});

const triggers = (extra: Partial<WorkflowTriggers> = {}) =>
  workflowTriggersSchema.parse({ turnChanged: true, ...extra });

async function chatTurn(): Promise<{ conversationId: string; runId: string }> {
  const conversationId = await openChat(t, { root });
  const runId = await sendMessage(t, conversationId, 'Fix the date divider.', {
    permission: 'do',
  });
  return { conversationId, runId };
}

const ended = (chat: { conversationId: string; runId: string }) => ({
  workspaceId: t.workspaceId,
  conversationId: chat.conversationId,
  runId: chat.runId,
});

const events = () => listTriggerEvents(t.db, t.workspaceId, FLOW);

async function checkAt(now: Date): Promise<void> {
  clock.set(now);
  await checkTriggers(clock.deps);
}

async function change(text: string) {
  await writeFile(join(root, 'notes.txt'), text);
}

describe('a turn that changed files', () => {
  it('queues one run per chat however often the turn is noted, due after the wait', async () => {
    await saveTriggers(t.db, t.workspaceId, FLOW, triggers({ debounceMinutes: 5 }));
    const chat = await chatTurn();

    await noteEndedTurn(t.db, ended(chat), true, at(9, 0));
    await noteEndedTurn(t.db, ended(chat), true, at(9, 2));

    const [event, ...rest] = await events();
    expect(rest).toEqual([]);
    expect(event).toMatchObject({ kind: 'turn_changed', state: 'pending' });
    expect(event!.dueAt).toBe(at(9, 7).toISOString());

    await checkAt(at(9, 6));
    expect(await runsOf(t)).toEqual([]);
    await checkAt(at(9, 7));
    const [run] = await runsOf(t);
    expect(run).toMatchObject({
      source: 'trigger',
      conversationId: chat.conversationId,
      status: 'running',
    });
    expect((await events())[0]).toMatchObject({ state: 'started', workflowRunId: run!.id });
  });

  it('posts in the triggering chat as a workflow message that is never the user’s', async () => {
    await saveTriggers(t.db, t.workspaceId, FLOW, triggers());
    const chat = await chatTurn();
    await noteEndedTurn(t.db, ended(chat), true, at(9, 0));
    await checkAt(at(9, 0));

    const [run] = await runsOf(t);
    const input = await loadRunInput(t.db, run!.runId!);
    expect(input.identity.threadId).toBe(chat.conversationId);
    expect(input.assistantSent).toBe(true);
    expect(userText(input)).toBe('');
    const { rows } = await t.db.query<{ source: string }>('SELECT source FROM runs WHERE id = $1', [
      run!.runId,
    ]);
    expect(rows[0]!.source).toBe('workflow');
  });

  it('does nothing when the turn kept no changes, or the trigger is off', async () => {
    await saveTriggers(t.db, t.workspaceId, FLOW, triggers());
    const chat = await chatTurn();
    await noteEndedTurn(t.db, ended(chat), false, at(9, 0));
    expect(await events()).toEqual([]);

    await saveTriggers(t.db, t.workspaceId, FLOW, triggers({ turnChanged: false }));
    await noteEndedTurn(t.db, ended(chat), true, at(9, 0));
    expect(await events()).toEqual([]);
  });

  it('never triggers from a turn a workflow started, so a run that edits cannot loop', async () => {
    await saveTriggers(t.db, t.workspaceId, FLOW, triggers());
    const chat = await chatTurn();
    await noteEndedTurn(t.db, ended(chat), true, at(9, 0));
    await checkAt(at(9, 0));
    const [run] = await runsOf(t);

    await noteEndedTurn(t.db, { ...ended(chat), runId: run!.runId! }, true, at(9, 1));
    expect((await events()).map((event) => event.state)).toEqual(['started']);
  });

  it('follows the project filter', async () => {
    const other = await gitRepo();
    try {
      const elsewhere = await openChat(t, { root: other });
      const { rows } = await t.db.query<{ project_id: string }>(
        'SELECT project_id FROM conversation_projects WHERE conversation_id = $1',
        [elsewhere],
      );
      await saveTriggers(t.db, t.workspaceId, FLOW, triggers({ projectId: rows[0]!.project_id }));
      const chat = await chatTurn();
      await noteEndedTurn(t.db, ended(chat), true, at(9, 0));
      expect(await events()).toEqual([]);
    } finally {
      await removeRepo(other);
    }
  });
});

describe('starting a queued trigger', () => {
  it('starts once when two checks race', async () => {
    await saveTriggers(t.db, t.workspaceId, FLOW, triggers());
    const chat = await chatTurn();
    await noteEndedTurn(t.db, ended(chat), true, at(9, 0));
    clock.set(at(9, 0));

    await Promise.all([checkTriggers(clock.deps), checkTriggers(clock.deps)]);
    expect(await runsOf(t)).toHaveLength(1);
  });

  it('a claim left by a stopped process starts once after a restart', async () => {
    await saveTriggers(t.db, t.workspaceId, FLOW, triggers());
    const chat = await chatTurn();
    await noteEndedTurn(t.db, ended(chat), true, at(9, 0));
    const [claim] = await claimDueTriggers(t.db, t.workspaceId, at(9, 0));
    expect(claim).toBeDefined();

    await checkAt(at(9, 0));
    expect(await runsOf(t)).toEqual([]);

    const later = new Date(at(9, 0).getTime() + STRANDED_TRIGGER_MS + 1000);
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

  it('waits while this workflow still runs in the chat, then starts', async () => {
    await saveTriggers(t.db, t.workspaceId, FLOW, triggers());
    const chat = await chatTurn();
    await noteEndedTurn(t.db, ended(chat), true, at(9, 0));
    await checkAt(at(9, 0));
    const [first] = await runsOf(t);

    await change('second change\n');
    await noteEndedTurn(t.db, ended(chat), true, at(9, 1));
    await checkAt(at(9, 1));
    expect(await runsOf(t)).toHaveLength(1);
    expect((await events()).find((event) => event.state === 'pending')).toBeDefined();

    await finishRun(t, first!);
    await checkAt(at(9, 2));
    expect(await runsOf(t)).toHaveLength(2);
  });

  it('skips when the chat’s diff is the same as at the last run', async () => {
    await saveTriggers(t.db, t.workspaceId, FLOW, triggers());
    const chat = await chatTurn();
    await change('first change\n');
    await noteEndedTurn(t.db, ended(chat), true, at(9, 0));
    await checkAt(at(9, 0));
    const [first] = await runsOf(t);
    await finishRun(t, first!);

    await noteEndedTurn(t.db, ended(chat), true, at(9, 5));
    await checkAt(at(9, 5));
    expect(await runsOf(t)).toHaveLength(1);
    expect((await events())[0]).toMatchObject({ state: 'skipped', reason: 'unchanged' });

    await change('another change\n');
    await noteEndedTurn(t.db, ended(chat), true, at(9, 6));
    await checkAt(at(9, 6));
    expect(await runsOf(t)).toHaveLength(2);
  });

  it('holds everything while Spark is paused', async () => {
    await saveTriggers(t.db, t.workspaceId, FLOW, triggers());
    const chat = await chatTurn();
    await noteEndedTurn(t.db, ended(chat), true, at(9, 0));
    await setSparkPaused(t.db, t.workspaceId, true);
    await checkAt(at(9, 0));
    expect(await runsOf(t)).toEqual([]);

    await setSparkPaused(t.db, t.workspaceId, false);
    await checkAt(at(9, 1));
    expect(await runsOf(t)).toHaveLength(1);
  });

  it('records why a trigger could not start when its chat was archived', async () => {
    await saveTriggers(t.db, t.workspaceId, FLOW, triggers());
    const chat = await chatTurn();
    await noteEndedTurn(t.db, ended(chat), true, at(9, 0));
    await t.db.query('UPDATE conversations SET archived_at = now() WHERE id = $1', [
      chat.conversationId,
    ]);
    await checkAt(at(9, 0));
    expect(await runsOf(t)).toEqual([]);
    expect((await events())[0]).toMatchObject({ state: 'not_started', reason: 'chat_gone' });
  });
});

describe('a new commit on the chat’s branch', () => {
  it('queues a run when the branch tip moves, matching the branch pattern', async () => {
    await saveTriggers(
      t.db,
      t.workspaceId,
      FLOW,
      triggers({ turnChanged: false, commit: true, branchGlob: 'spark/*' }),
    );
    const chat = await chatTurn();
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args]);
    git('checkout', '-q', '-b', 'spark/fix-divider');
    await noteEndedTurn(t.db, ended(chat), false, at(9, 0));
    expect(await events()).toEqual([]);

    await change('committed\n');
    git('commit', '-qam', 'fix');
    await noteEndedTurn(t.db, ended(chat), false, at(9, 1));
    expect((await events()).map((event) => event.kind)).toEqual(['commit']);

    git('checkout', '-q', '-b', 'feature/other');
    await change('elsewhere\n');
    git('commit', '-qam', 'other');
    await checkAt(at(9, 1));
    await noteEndedTurn(t.db, ended(chat), false, at(9, 2));
    expect((await events()).map((event) => event.kind)).toEqual(['commit']);
  });
});

describe('a pull request Spark opened', () => {
  async function watch(conversationId: string, head: string, openedVia = 'agent') {
    const id = randomUUID();
    await t.db.query(
      `INSERT INTO pr_watches (id, workspace_id, conversation_id, host, owner, repo, number, url,
         branch, head_sha, opened_via)
       VALUES ($1, $2, $3, 'github.com', 'acme', 'widgets', $4, 'https://github.com/acme/widgets/pull/1',
         'spark/fix', $5, $6)`,
      [id, t.workspaceId, conversationId, Math.floor(Math.random() * 100000) + 1, head, openedVia],
    );
    return id;
  }

  it('queues a run once per head and ignores heads seen when the trigger was turned on', async () => {
    const chat = await chatTurn();
    const watchId = await watch(chat.conversationId, 'aaaa111');
    await saveTriggers(
      t.db,
      t.workspaceId,
      FLOW,
      triggers({ turnChanged: false, pullRequest: true }),
    );
    await seedPullMarks(t.db, t.workspaceId, FLOW, null);

    await checkAt(at(9, 0));
    expect(await events()).toEqual([]);

    await t.db.query(`UPDATE pr_watches SET head_sha = 'bbbb222' WHERE id = $1`, [watchId]);
    await checkAt(at(9, 1));
    await checkAt(at(9, 2));
    expect((await events()).map((event) => event.kind)).toEqual(['pull_request']);
    expect(await runsOf(t)).toHaveLength(1);
  });

  it('leaves pull requests Spark did not open alone', async () => {
    const chat = await chatTurn();
    await saveTriggers(
      t.db,
      t.workspaceId,
      FLOW,
      triggers({ turnChanged: false, pullRequest: true }),
    );
    await watch(chat.conversationId, 'cccc333', 'discovery');
    await checkAt(at(9, 0));
    expect(await events()).toEqual([]);
  });
});
