import path from 'node:path';
import type { AgentRole } from '@spark-outpost/contracts';
import { LeaseLostError } from '../persistence/run-events.ts';
import {
  getWorktree,
  insertWorktree,
  liveWorktrees,
  markRemoved,
  orphanedWorktrees,
  saveResult,
  type WorktreeRecord,
} from '../persistence/worktrees.ts';
import type { Db } from '../persistence/db.ts';
import { commitTree } from '../projects/snapshot.ts';
import {
  addWorktree,
  branchName,
  commitWorktree,
  excludeSparkDir,
  groupBase,
  removeWorktree,
  repoTop,
  worktreePath,
} from '../projects/worktrees.ts';
import { APPROVAL_TIMEOUT_MESSAGE } from '../workflow/approval-gate.ts';
import { CheckpointTimeout } from './checkpoint.ts';
import { land, treeOf } from './land.ts';
import { ensureParentSnapshot, runMember, type Place } from './members.ts';
import { mergeCopies, type Finished } from './merge.ts';
import { isResearchStep } from './parallel.ts';
import { markPlanSteps } from './plan-progress.ts';
import { nameFor } from './member-routes.ts';
import { publish, routeKey, type MemberResult, type Session } from './session.ts';
import type { AgentOutcome, FlowEvent, GroupResult, Spawn } from './transitions.ts';

interface Copies {
  root: string;
  top: string;
  base: string;
}

interface Ran {
  stepIndex: number;
  steps: number[];
  role: AgentRole;
  result: MemberResult;
}

async function prepareCopies(s: Session, group: string): Promise<Copies> {
  const root = s.input.projectRoots[0]!;
  await ensureParentSnapshot(s);
  await excludeSparkDir(root);
  const [top, base] = await Promise.all([
    repoTop(root),
    groupBase(root, `${s.lease.runId} ${group}`),
  ]);
  return { root, top, base };
}

function copyFor(s: Session, copies: Copies): NonNullable<Place['copy']> {
  return (name) => {
    const branch = branchName(s.taskId, name);
    return {
      branch,
      prepare: async (runId) => {
        const target = worktreePath(copies.root, runId);
        await insertWorktree(s.deps.db, {
          runId,
          orchestrationRunId: s.lease.runId,
          repoRoot: copies.root,
          path: path.join(target, path.relative(copies.top, copies.root)),
          branch,
          baseCommit: copies.base,
        });
        await addWorktree(copies.root, target, branch, copies.base);
      },
    };
  };
}

function limited<T>(s: Session, work: () => Promise<T>): Promise<T> {
  const global = s.deps.agentSlots;
  return s.slots.run(() => (global ? global.run(work) : work()));
}

function roleOf(s: Session, stepIndex: number): AgentRole {
  return isResearchStep(s.flow.steps[stepIndex] ?? '') ? 'scout' : 'builder';
}

async function landMember(
  s: Session,
  spawn: Spawn,
  first: MemberResult,
  place: Place,
  mainTree: string | null,
): Promise<MemberResult> {
  const record = await getWorktree(s.deps.db, first.runId);
  const landed = await land(s, spawn, first, {
    cwd: record?.path ?? s.input.projectRoots[0]!,
    before: record ? await commitTree(record.repoRoot, record.baseCommit) : mainTree,
    place,
    copy: record ? first.name : null,
    copyRunId: record?.runId ?? null,
  });
  return { ...landed.result, ticked: landed.ticked };
}

async function runOne(
  s: Session,
  stepIndex: number,
  lane: readonly number[] | null,
  group: string,
  copies: Copies | null,
): Promise<Ran> {
  const role = roleOf(s, stepIndex);
  const place: Place = {
    group,
    ...(copies && role === 'builder' ? { copy: copyFor(s, copies) } : {}),
  };
  const carry = lane && lane.length > 1 ? [...lane] : undefined;
  const spawn: Spawn = { role, stepIndex, escalate: false, note: null, reason: 'first', carry };
  const result = await limited(s, async () => {
    const mainTree =
      role === 'builder' && !copies ? await treeOf(s, s.input.projectRoots[0]!) : null;
    const { result: first } = await runMember(s, spawn, place);
    return role === 'builder' ? landMember(s, spawn, first, place, mainTree) : first;
  });
  return { stepIndex, steps: lane ? [...lane] : [stepIndex], role, result };
}

export async function removeCopy(db: Db, record: WorktreeRecord): Promise<void> {
  await removeWorktree(record.repoRoot, worktreePath(record.repoRoot, record.runId), record.branch);
  await markRemoved(db, record.runId);
}

async function removeAll(db: Db, records: readonly WorktreeRecord[]): Promise<number> {
  let removed = 0;
  for (const record of records) {
    try {
      await removeCopy(db, record);
      removed += 1;
    } catch (error) {
      console.error(`Could not remove the worktree for run ${record.runId}`, error);
    }
  }
  return removed;
}

export async function cleanupCopies(s: Session): Promise<void> {
  await removeAll(s.deps.db, await liveWorktrees(s.deps.db, s.lease.runId));
}

export async function cleanOrphanedCopies(db: Db): Promise<number> {
  return removeAll(db, await orphanedWorktrees(db));
}

async function finishCopy(s: Session, ran: Ran): Promise<Finished | null> {
  const record = await getWorktree(s.deps.db, ran.result.copyRunId ?? ran.result.runId);
  if (!record) return null;
  const target = worktreePath(record.repoRoot, record.runId);
  const resultCommit = await commitWorktree(
    record.repoRoot,
    target,
    record.branch,
    record.baseCommit,
    record.runId,
  );
  await saveResult(s.deps.db, record.runId, resultCommit);
  return {
    stepIndex: ran.stepIndex,
    steps: ran.steps,
    runId: record.runId,
    name: ran.result.name,
    record: { ...record, resultCommit },
  };
}

function outcomeOf(result: MemberResult): AgentOutcome {
  return result.outcome === 'lease_lost' ? 'cancelled' : result.outcome;
}

async function settleGroup(s: Session, ran: readonly Ran[]): Promise<FlowEvent> {
  if (ran.some((item) => item.result.outcome === 'lease_lost')) throw new LeaseLostError(s.lease);
  if (ran.some((item) => item.result.error === APPROVAL_TIMEOUT_MESSAGE)) {
    throw new CheckpointTimeout();
  }
  if (s.budgetHit && s.control.reason() === null) {
    return { type: 'budget_exceeded', limit: s.budgetHit };
  }
  const outcomes = new Map(ran.map((item) => [item.stepIndex, outcomeOf(item.result)]));
  if ([...outcomes.values()].includes('cancelled')) {
    return { type: 'group_done', results: toResults(outcomes), stopped: false };
  }
  const finished: Finished[] = [];
  for (const item of ran) {
    if (item.result.outcome !== 'succeeded') continue;
    const copy = item.role === 'builder' ? await finishCopy(s, item) : null;
    if (copy) finished.push(copy);
    else await markDone(s, item);
  }
  const merged = await mergeCopies(s, finished);
  merged.results.forEach((outcome, stepIndex) => outcomes.set(stepIndex, outcome));
  return { type: 'group_done', results: toResults(outcomes, ran), stopped: merged.stopped };
}

async function markDone(s: Session, item: Ran): Promise<void> {
  await markPlanSteps(s, item.steps, 'completed', item.result.runId);
}

function toResults(
  outcomes: ReadonlyMap<number, AgentOutcome>,
  ran: readonly Ran[] = [],
): GroupResult[] {
  return [...outcomes].map(([stepIndex, outcome]) => {
    const ticked = ran.find((item) => item.stepIndex === stepIndex)?.result.ticked ?? [];
    return { stepIndex, outcome, ...(ticked.length > 0 ? { ticked } : {}) };
  });
}

export async function runGroup(
  s: Session,
  stepIndexes: readonly number[],
  lanes: readonly (readonly number[])[] = [],
): Promise<FlowEvent> {
  s.groups += 1;
  const group = `g${s.groups}`;
  const builders = stepIndexes.filter((index) => !isResearchStep(s.flow.steps[index] ?? ''));
  try {
    const copies = builders.length > 1 ? await prepareCopies(s, group) : null;
    for (const stepIndex of stepIndexes) {
      const role = roleOf(s, stepIndex);
      await nameFor(s, role, routeKey(role, stepIndex));
    }
    await markPlanSteps(s, stepIndexes, 'in_progress', s.lease.runId);
    await publish(s);
    const laneFor = (head: number) => lanes.find((lane) => lane[0] === head) ?? null;
    const settled = await Promise.allSettled(
      stepIndexes.map((stepIndex) => runOne(s, stepIndex, laneFor(stepIndex), group, copies)),
    );
    const rejected = settled.find((item) => item.status === 'rejected');
    if (rejected) throw rejected.reason;
    const ran = settled.flatMap((item) => (item.status === 'fulfilled' ? [item.value] : []));
    for (const item of ran) {
      if (item.role === 'scout' && item.result.outcome === 'failed') {
        await markPlanSteps(s, [item.stepIndex], 'failed', item.result.runId);
      }
    }
    return await settleGroup(s, ran);
  } finally {
    await cleanupCopies(s);
    await publish(s).catch(() => undefined);
  }
}
