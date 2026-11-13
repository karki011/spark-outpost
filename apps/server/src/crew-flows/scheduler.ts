import { decideDue, workflowProblems, type DueAction } from '@spark-outpost/contracts';
import { withTransaction, type Db, type DbClient } from '../persistence/db.ts';
import { sparkPaused } from '../persistence/spark-pause.ts';
import {
  advanceChecked,
  claimSlot,
  deleteSchedule,
  heldSince,
  listSchedules,
  openScheduleChat,
  projectLinked,
  reclaimStrandedSlots,
  recordQuietSlot,
  releaseHeld,
  setScheduleChat,
  settleSlot,
  getSchedule,
  workflowRunning,
  type ClaimedSlot,
  type QuietSlot,
  type StoredSchedule,
} from './schedule-records.ts';
import { startWorkflowRun, type StartRunDeps } from './start-run.ts';
import { workspaceSparkIds } from './step-sparks.ts';

const CHECK_EVERY_MS = 30_000;
export const STRANDED_CLAIM_MS = 60_000;

export interface SchedulerDeps extends StartRunDeps {
  now(): Date;
}

export interface WorkflowScheduler {
  stop(): void;
}

type StartAction = Extract<DueAction, { kind: 'start' }>;
type Blocker = Pick<QuietSlot, 'state' | 'reason' | 'detail'>;

async function startBlocker(
  deps: SchedulerDeps,
  client: DbClient,
  stored: StoredSchedule,
): Promise<Blocker | null> {
  const file = await deps.store.read(stored.workflowId);
  const problems = file
    ? workflowProblems(file.workflow.steps, await workspaceSparkIds(client, deps.workspaceId))
    : [];
  if (problems[0]) return { state: 'not_started', reason: 'problem', detail: problems[0].text };
  const { projectId } = stored.schedule;
  if (projectId !== null && !(await projectLinked(client, deps.workspaceId, projectId))) {
    return { state: 'not_started', reason: 'project_gone', detail: null };
  }
  if (await workflowRunning(client, deps.workspaceId, stored.workflowId)) {
    return { state: 'skipped', reason: 'previous_running', detail: null };
  }
  return null;
}

async function claimStart(
  deps: SchedulerDeps,
  client: DbClient,
  stored: StoredSchedule,
  action: StartAction,
  now: Date,
): Promise<ClaimedSlot | null> {
  const blocker = await startBlocker(deps, client, stored);
  if (blocker === null) {
    return claimSlot(client, deps.workspaceId, stored.workflowId, action.source, action.slotAt, now);
  }
  await recordQuietSlot(
    client,
    deps.workspaceId,
    {
      ...blocker,
      workflowId: stored.workflowId,
      source: action.source,
      slotAt: action.slotAt,
      lastSlotAt: action.slotAt,
    },
    now,
  );
  return null;
}

async function settleDue(
  deps: SchedulerDeps,
  client: DbClient,
  stored: StoredSchedule,
  paused: boolean,
  now: Date,
): Promise<ClaimedSlot | null> {
  const { workspaceId } = deps;
  const { workflowId } = stored;
  if (!(await advanceChecked(client, workspaceId, stored, now))) return null;
  const { action, release } = decideDue({
    schedule: stored.schedule,
    lastChecked: stored.lastCheckedAt,
    now,
    paused,
    heldSince: await heldSince(client, workspaceId, workflowId),
  });
  if (release) await releaseHeld(client, workspaceId, workflowId, now);
  if (action.kind === 'start') return claimStart(deps, client, stored, action, now);
  if (action.kind === 'hold') {
    await recordQuietSlot(
      client,
      workspaceId,
      { workflowId, state: 'held', reason: 'paused', detail: null, source: 'schedule', ...action },
      now,
    );
  }
  if (action.kind === 'skip_missed') {
    await recordQuietSlot(
      client,
      workspaceId,
      {
        workflowId,
        state: 'skipped',
        reason: 'missed',
        detail: null,
        source: 'catch_up',
        slotAt: action.slotAt,
        lastSlotAt: action.slotAt,
      },
      now,
    );
  }
  return null;
}

async function launch(deps: SchedulerDeps, claim: ClaimedSlot): Promise<void> {
  const { db, workspaceId } = deps;
  const stored = await getSchedule(db, workspaceId, claim.workflowId);
  if (!stored) return;
  try {
    const conversationId = await openScheduleChat(db, workspaceId, stored.conversationId);
    const run = await startWorkflowRun(deps, {
      kind: 'run',
      workflowId: claim.workflowId,
      messageId: claim.messageId,
      source: claim.source,
      conversationId,
      projectId: stored.schedule.projectId,
      message: stored.schedule.message,
    });
    await settleSlot(db, claim.id, { state: 'started', workflowRunId: run.id });
    if (run.conversationId !== stored.conversationId) {
      await setScheduleChat(db, workspaceId, claim.workflowId, run.conversationId);
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await settleSlot(db, claim.id, { state: 'not_started', reason: 'error', detail });
  }
}

async function checkSchedule(
  deps: SchedulerDeps,
  stored: StoredSchedule,
  paused: boolean,
  now: Date,
): Promise<void> {
  if ((await deps.store.read(stored.workflowId)) === null) {
    await deleteSchedule(deps.db, deps.workspaceId, stored.workflowId);
    return;
  }
  const claim = await withTransaction(deps.db, (client) =>
    settleDue(deps, client, stored, paused, now),
  );
  if (claim) await launch(deps, claim);
}

export async function checkSchedules(deps: SchedulerDeps): Promise<void> {
  const now = deps.now();
  const { db, workspaceId } = deps;
  for (const claim of await reclaimStrandedSlots(db, workspaceId, now, STRANDED_CLAIM_MS)) {
    await launch(deps, claim);
  }
  const paused = await sparkPaused(db, workspaceId);
  for (const stored of await listSchedules(db, workspaceId, 'enabled')) {
    await checkSchedule(deps, stored, paused, now).catch((error: unknown) => {
      console.error(`Could not check the schedule of workflow ${stored.workflowId}`, error);
    });
  }
}

export function startWorkflowScheduler(
  deps: SchedulerDeps,
  everyMs = CHECK_EVERY_MS,
): WorkflowScheduler {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await checkSchedules(deps);
    } catch (error) {
      console.error('The workflow schedule check failed', error);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), everyMs);
  timer.unref();
  return { stop: () => clearInterval(timer) };
}
