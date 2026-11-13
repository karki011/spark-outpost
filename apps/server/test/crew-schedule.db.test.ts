import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { claimSlot, getSchedule } from '../src/crew-flows/schedule-records.ts';
import { checkSchedules, STRANDED_CLAIM_MS } from '../src/crew-flows/scheduler.ts';
import { workflowStore } from '../src/crew-flows/workflow-store.ts';
import { userText } from '../src/outposts/user-asked.ts';
import { getConversationDetail } from '../src/persistence/conversations.ts';
import { inactiveChats } from '../src/persistence/inactive-chats.ts';
import { setSparkPaused } from '../src/persistence/spark-pause.ts';
import { createProject } from '../src/projects/projects.ts';
import { loadRunInput } from '../src/workflow/run-input.ts';
import {
  at,
  everyHalfHour,
  finishRun,
  FLOW,
  quietSlots,
  runsOf,
  schedulerClock,
  slotsOf,
} from './crew-schedule-support.ts';
import { newSpark, saveFlow, step, useWorkflowsDir } from './crew-workflow-support.ts';
import { createTestDb, type TestDb } from './support.ts';
import { gitRepo, removeRepo } from './turn-support.ts';
import { connectAgents } from './turn-worker.ts';

let t: TestDb;
let root: string;
let dropWorkflows: () => Promise<void>;
let sparkId: string;
let clock: ReturnType<typeof schedulerClock>;

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  dropWorkflows = await useWorkflowsDir();
  await connectAgents(t);
  sparkId = (await newSpark(t, 'Pip')).id;
  await saveFlow(t, FLOW, [step('review', sparkId)]);
  clock = schedulerClock(t, at(9, 10));
});

afterEach(async () => {
  await t.cleanup();
  await removeRepo(root);
  await dropWorkflows();
});

const iso = (date: Date) => date.toISOString();

describe('a schedule that comes due', () => {
  it('starts one run in a chat of its own, named after the workflow, in its project', async () => {
    const { project } = await createProject(t.db, t.workspaceId, root);
    await clock.save(everyHalfHour({ projectId: project.id }));

    await clock.checkAt(at(9, 20));
    expect(await runsOf(t)).toEqual([]);

    await clock.checkAt(at(9, 31));
    const [run] = await runsOf(t);
    expect(run).toMatchObject({ source: 'schedule', kind: 'run', status: 'running' });
    const chat = await getConversationDetail(t.db, run!.conversationId!);
    expect(chat?.conversation).toMatchObject({ title: `Flow ${FLOW}`, projectIds: [project.id] });
    expect((await getSchedule(t.db, t.workspaceId, FLOW))?.conversationId).toBe(
      run!.conversationId,
    );

    await clock.checkAt(at(9, 32));
    expect(await runsOf(t)).toHaveLength(1);

    await finishRun(t, run!);
    await clock.checkAt(at(10, 0));
    const runs = await runsOf(t);
    expect(runs).toHaveLength(2);
    expect(new Set(runs.map((entry) => entry.conversationId)).size).toBe(1);
  });

  it('starts a slot once when two checks race', async () => {
    await clock.save(everyHalfHour());
    clock.set(at(9, 30));

    await Promise.all([checkSchedules(clock.deps), checkSchedules(clock.deps)]);

    expect(await runsOf(t)).toHaveLength(1);
    expect((await slotsOf(t)).map((slot) => slot.state)).toEqual(['started']);
  });

  it('starts a slot that was claimed before a restart, once', async () => {
    await clock.save(everyHalfHour());
    await claimSlot(t.db, t.workspaceId, FLOW, 'schedule', at(9, 30), at(9, 30));

    await clock.checkAt(new Date(at(9, 30).getTime() + STRANDED_CLAIM_MS / 2));
    expect(await runsOf(t)).toEqual([]);

    await clock.checkAt(new Date(at(9, 30).getTime() + STRANDED_CLAIM_MS + 1));
    await clock.checkAt(new Date(at(9, 30).getTime() + 2 * STRANDED_CLAIM_MS + 2));
    expect(await runsOf(t)).toHaveLength(1);
    expect((await slotsOf(t)).map((slot) => slot.state)).toEqual(['started']);
  });

  it('never counts as the message of the user', async () => {
    await clock.save(everyHalfHour({ message: 'Push the branch and open a pull request.' }));
    await clock.checkAt(at(9, 30));

    const [run] = await runsOf(t);
    const source = await t.db.query<{ source: string }>('SELECT source FROM runs WHERE id = $1', [
      run!.runId,
    ]);
    expect(source.rows[0]?.source).toBe('workflow');
    const input = await loadRunInput(t.db, run!.runId!);
    expect(input.assistantSent).toBe(true);
    expect(userText(input)).toBe('');
  });

  it('does nothing while the schedule is off', async () => {
    await clock.save(everyHalfHour({ enabled: false }));
    await clock.checkAt(at(9, 30));
    expect(await runsOf(t)).toEqual([]);
    expect(await slotsOf(t)).toEqual([]);
  });
});

describe('slots missed while Spark was closed or the Mac slept', () => {
  it('runs once when back, however many were missed', async () => {
    await clock.save(everyHalfHour());

    await clock.checkAt(at(14, 12));
    await clock.checkAt(at(14, 13));

    const runs = await runsOf(t);
    expect(runs.map((run) => run.source)).toEqual(['catch_up']);
    expect(await quietSlots(t)).toEqual([]);
  });

  it('runs the slot that is due now as scheduled, and no catch-up beside it', async () => {
    await clock.save(everyHalfHour());
    await clock.checkAt(at(14, 1));
    expect((await runsOf(t)).map((run) => run.source)).toEqual(['schedule']);
  });

  it('skips and says so when the schedule is set to skip', async () => {
    await clock.save(everyHalfHour({ missed: 'skip' }));

    await clock.checkAt(at(14, 12));

    expect(await runsOf(t)).toEqual([]);
    expect(await quietSlots(t)).toEqual([
      { state: 'skipped', reason: 'missed', slotAt: iso(at(9, 30)), lastSlotAt: iso(at(9, 30)) },
    ]);
  });

  it('catches up the next morning for a window that closed overnight', async () => {
    await clock.save(everyHalfHour());
    clock.set(at(17, 45));
    await clock.save(everyHalfHour());

    await clock.checkAt(at(8, 0, 17));
    expect((await runsOf(t)).map((run) => run.source)).toEqual(['catch_up']);
  });
});

describe('a slot that comes due while the previous run is still going', () => {
  it('is skipped with the reason, and repeats extend one line', async () => {
    await clock.save(everyHalfHour());
    await clock.checkAt(at(9, 30));

    await clock.checkAt(at(10, 0));
    await clock.checkAt(at(10, 30));

    expect(await runsOf(t)).toHaveLength(1);
    expect(await quietSlots(t)).toEqual([
      {
        state: 'skipped',
        reason: 'previous_running',
        slotAt: iso(at(10, 0)),
        lastSlotAt: iso(at(10, 30)),
      },
    ]);
  });
});

describe('Spark pause', () => {
  it('holds slots with the reason and runs one when Spark resumes', async () => {
    await clock.save(everyHalfHour());
    await setSparkPaused(t.db, t.workspaceId, true);

    await clock.checkAt(at(9, 31));
    await clock.checkAt(at(10, 1));

    expect(await runsOf(t)).toEqual([]);
    expect(await quietSlots(t)).toEqual([
      { state: 'held', reason: 'paused', slotAt: iso(at(9, 30)), lastSlotAt: iso(at(10, 0)) },
    ]);

    await setSparkPaused(t.db, t.workspaceId, false);
    await clock.checkAt(at(10, 12));
    await clock.checkAt(at(10, 13));

    expect((await runsOf(t)).map((run) => run.source)).toEqual(['catch_up']);
    const [held] = (await slotsOf(t)).filter((slot) => slot.state === 'held');
    expect(held?.releasedAt).toBe(iso(at(10, 12)));
  });

  it('starts none of the held slots when the schedule is set to skip', async () => {
    await clock.save(everyHalfHour({ missed: 'skip' }));
    await setSparkPaused(t.db, t.workspaceId, true);
    await clock.checkAt(at(9, 31));
    await setSparkPaused(t.db, t.workspaceId, false);

    await clock.checkAt(at(9, 40));
    expect(await runsOf(t)).toEqual([]);

    await clock.checkAt(at(10, 0));
    expect((await runsOf(t)).map((run) => run.source)).toEqual(['schedule']);
  });
});

describe('a schedule that cannot start', () => {
  it('says the workflow has a problem when a Spark is gone', async () => {
    await clock.save(everyHalfHour());
    await t.db.query('DELETE FROM teammates WHERE id = $1', [sparkId]);

    await clock.checkAt(at(9, 30));

    expect(await runsOf(t)).toEqual([]);
    const [slot] = await slotsOf(t);
    expect(slot).toMatchObject({ state: 'not_started', reason: 'problem' });
    expect(slot?.detail).toBeTruthy();
  });

  it('says the project is gone', async () => {
    const { project } = await createProject(t.db, t.workspaceId, root);
    await clock.save(everyHalfHour({ projectId: project.id }));
    await t.db.query('DELETE FROM projects WHERE id = $1', [project.id]);

    await clock.checkAt(at(9, 30));

    expect(await runsOf(t)).toEqual([]);
    expect(await slotsOf(t)).toMatchObject([{ state: 'not_started', reason: 'project_gone' }]);
  });

  it('drops the schedule of a workflow whose file is gone', async () => {
    await clock.save(everyHalfHour());
    await workflowStore().remove(FLOW);

    await clock.checkAt(at(9, 30));

    expect(await getSchedule(t.db, t.workspaceId, FLOW)).toBeNull();
    expect(await runsOf(t)).toEqual([]);
  });
});

describe('the chat of a schedule', () => {
  async function ageChat(conversationId: string): Promise<void> {
    await t.db.query(
      `UPDATE conversations SET created_at = now() - interval '60 days' WHERE id = $1`,
      [conversationId],
    );
    await t.db.query(
      `UPDATE messages SET created_at = now() - interval '60 days' WHERE conversation_id = $1`,
      [conversationId],
    );
    await t.db.query(
      `UPDATE runs SET created_at = now() - interval '60 days',
         started_at = now() - interval '60 days', finished_at = now() - interval '60 days'
       WHERE conversation_id = $1`,
      [conversationId],
    );
  }

  it('is not archived for inactivity while the schedule is on', async () => {
    await clock.save(everyHalfHour());
    await clock.checkAt(at(9, 30));
    const [run] = await runsOf(t);
    await finishRun(t, run!);
    await ageChat(run!.conversationId!);

    expect(await inactiveChats(t.db, t.workspaceId, 30)).toEqual([]);

    await clock.save(everyHalfHour({ enabled: false }));
    expect(await inactiveChats(t.db, t.workspaceId, 30)).toEqual([run!.conversationId]);
  });

  it('is replaced by a new chat when the user archived it', async () => {
    await clock.save(everyHalfHour());
    await clock.checkAt(at(9, 30));
    const [first] = await runsOf(t);
    await finishRun(t, first!);
    await t.db.query('UPDATE conversations SET archived_at = now() WHERE id = $1', [
      first!.conversationId,
    ]);

    await clock.checkAt(at(10, 0));

    const runs = await runsOf(t);
    expect(runs).toHaveLength(2);
    expect(new Set(runs.map((run) => run.conversationId)).size).toBe(2);
  });
});
