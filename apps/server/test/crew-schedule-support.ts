import {
  workflowScheduleSchema,
  type ScheduleSlot,
  type WorkflowRun,
  type WorkflowSchedule,
} from '@spark-outpost/contracts';
import { resolveRunTarget } from '../src/api/run-target.ts';
import { listWorkflowRuns } from '../src/crew-flows/run-records.ts';
import { listScheduleSlots, saveSchedule } from '../src/crew-flows/schedule-records.ts';
import { checkSchedules, type SchedulerDeps } from '../src/crew-flows/scheduler.ts';
import { workflowStore } from '../src/crew-flows/workflow-store.ts';
import type { TestDb } from './support.ts';

export const FLOW = 'pre-pr-review';

export const at = (hour: number, minute: number, day = 16) =>
  new Date(2026, 10, day, hour, minute);

export function everyHalfHour(extra: Partial<WorkflowSchedule> = {}): WorkflowSchedule {
  return workflowScheduleSchema.parse({
    enabled: true,
    every: 30,
    unit: 'minutes',
    from: '09:00',
    to: '18:00',
    anchor: '2026-11-01',
    projectId: null,
    message: 'Review what changed.',
    ...extra,
  });
}

export function schedulerClock(t: TestDb, start: Date) {
  const clock = { now: start };
  const deps: SchedulerDeps = {
    db: t.db,
    workspaceId: t.workspaceId,
    store: workflowStore(),
    runTarget: (conversationId) =>
      resolveRunTarget({ db: t.db, workspaceId: t.workspaceId }, conversationId),
    now: () => clock.now,
  };
  return {
    deps,
    save: (schedule: WorkflowSchedule, id = FLOW) =>
      saveSchedule(t.db, t.workspaceId, id, schedule, clock.now),
    checkAt: async (now: Date) => {
      clock.now = now;
      await checkSchedules(deps);
    },
    set: (now: Date) => {
      clock.now = now;
    },
  };
}

export const runsOf = (t: TestDb, id = FLOW): Promise<WorkflowRun[]> =>
  listWorkflowRuns(t.db, t.workspaceId, id);

export const slotsOf = (t: TestDb, id = FLOW): Promise<ScheduleSlot[]> =>
  listScheduleSlots(t.db, t.workspaceId, id);

export async function quietSlots(t: TestDb, id = FLOW) {
  return (await slotsOf(t, id))
    .filter((slot) => slot.state !== 'started')
    .map(({ state, reason, slotAt, lastSlotAt }) => ({ state, reason, slotAt, lastSlotAt }));
}

export async function finishRun(
  t: TestDb,
  run: WorkflowRun,
  status: 'succeeded' | 'failed' = 'succeeded',
): Promise<void> {
  await t.db.query(
    `UPDATE workflow_runs SET status = $2, finished_at = now() WHERE id = $1`,
    [run.id, status],
  );
  await t.db.query(
    `UPDATE runs SET status = $2, started_at = now(), finished_at = now(),
       error = CASE WHEN $2 = 'failed' THEN 'A step failed.' END
     WHERE id = $1`,
    [run.runId, status],
  );
}
