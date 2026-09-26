import type { CheckBody } from '@spark-outpost/contracts';
import { saveSnapshot } from '../persistence/run-snapshots.ts';
import { commitTree, commitWorkingTree, gitChanges, gitDiffBetween } from '../projects/snapshot.ts';
import { attributeFiles, laneSnapshots } from '../projects/shared-tree.ts';
import { groupBase, pinSnapshot } from '../projects/worktrees.ts';
import { PATCH_LIMIT } from './context.ts';
import { reviewWanted } from './depth.ts';
import { checkAndFix, queueDiffReview } from './land.ts';
import { ensureParentSnapshot } from './members.ts';
import type { MemberResult, Session } from './session.ts';
import { stepFiles } from './step-files.ts';
import type { Spawn } from './transitions.ts';

export interface GroupBase {
  root: string;
  commit: string;
  tree: string;
}

export interface LandedLane {
  steps: number[];
  result: MemberResult;
  files: string[];
  reviewed: boolean;
}

export async function sharedBase(s: Session, label: string): Promise<GroupBase> {
  const root = s.input.projectRoots[0]!;
  await ensureParentSnapshot(s);
  const commit = await groupBase(root, `${s.lease.runId} ${label}`);
  return { root, commit, tree: await commitTree(root, commit) };
}

export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? 'The Builders';
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

function declaredFiles(s: Session, steps: readonly number[]): string[] {
  return steps.flatMap((index) => stepFiles(s.flow.steps[index] ?? '').changes);
}

async function creationOrder(s: Session, runIds: readonly string[]): Promise<string[]> {
  const { rows } = await s.deps.db.query<{ id: string }>(
    'SELECT id FROM runs WHERE id = ANY($1::uuid[]) ORDER BY created_at, id',
    [runIds],
  );
  return rows.map((row) => row.id);
}

export async function attributeShared(
  s: Session,
  base: GroupBase,
  lanes: readonly Omit<LandedLane, 'files'>[],
): Promise<LandedLane[]> {
  const source = await commitWorkingTree(base.root, [base.commit], 'Spark Outpost: shared lanes');
  const changed = (await gitChanges(base.root, base.commit, source)).map((change) => change.path);
  const created = await creationOrder(
    s,
    lanes.map((lane) => lane.result.runId),
  );
  const ordered = [...lanes].sort(
    (a, b) => created.indexOf(a.result.runId) - created.indexOf(b.result.runId),
  );
  const attribution = attributeFiles(
    changed,
    ordered.map((lane) => ({ key: lane.result.runId, declared: declaredFiles(s, lane.steps) })),
  );
  const snapshots = await laneSnapshots(
    base.root,
    base.commit,
    source,
    ordered.map((lane) => lane.result.runId),
    attribution.files,
  );
  for (const snapshot of snapshots) {
    await pinSnapshot(base.root, snapshot.key, snapshot.commit);
    await saveSnapshot(s.deps.db, snapshot.key, {
      kind: 'git',
      ref: snapshot.commit,
      root: base.root,
    });
  }
  return ordered
    .map((lane) => ({ ...lane, files: attribution.files.get(lane.result.runId) ?? [] }))
    .sort((a, b) => a.steps[0]! - b.steps[0]!);
}

export async function copyFiles(root: string, base: string, result: string): Promise<string[]> {
  return (await gitChanges(root, base, result)).map((change) => change.path);
}

async function reviewLanes(
  s: Session,
  base: GroupBase,
  lanes: readonly LandedLane[],
  checks: CheckBody | null,
) {
  const pending = lanes.filter((lane) => !lane.reviewed && lane.files.length > 0);
  if (pending.length === 0 || !reviewWanted(s.flow) || s.flow.reviewed) return;
  const files = pending.flatMap((lane) => lane.files);
  const after = await commitWorkingTree(base.root, [base.commit], 'Spark Outpost: merged group');
  const merged = await gitDiffBetween(base.root, base.commit, after, files);
  const together = pending.length === 1 || merged.patch.length <= PATCH_LIMIT;
  const groups = together ? [pending] : pending.map((lane) => [lane]);
  for (const group of groups) {
    const steps = group.flatMap((lane) => lane.steps).sort((a, b) => a - b);
    await queueDiffReview(s, {
      key: `group:${steps.join(',')}`,
      subject: { name: joinNames(group.map((lane) => lane.result.name)), steps },
      cwd: base.root,
      before: base.tree,
      paths: group.flatMap((lane) => lane.files),
      checks,
    });
  }
}

export async function landGroup(
  s: Session,
  base: GroupBase,
  lanes: readonly LandedLane[],
  complete: boolean,
): Promise<void> {
  const built = lanes.filter((lane) => lane.result.outcome === 'succeeded');
  if (built.length === 0 || s.budgetHit) return;
  if (!complete || built.length < 2) {
    await reviewLanes(s, base, built, null);
    return;
  }
  const last = built.at(-1)!;
  const steps = built.flatMap((lane) => lane.steps).sort((a, b) => a - b);
  const spawn: Spawn = {
    role: 'builder',
    stepIndex: last.steps[0]!,
    escalate: false,
    note: null,
    reason: 'first',
    ...(steps.length > 1 ? { carry: steps } : {}),
  };
  const merged: MemberResult = {
    ...last.result,
    name: joinNames(built.map((lane) => lane.result.name)),
  };
  const checked = await checkAndFix(s, spawn, merged, {
    cwd: base.root,
    before: base.tree,
    place: null,
    copy: null,
    copyRunId: null,
  });
  if (checked.result.outcome !== 'succeeded') return;
  await reviewLanes(s, base, built, checked.checks);
}
