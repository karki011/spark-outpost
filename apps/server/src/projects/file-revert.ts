import { access, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { FileRevertCheck, FileRevertResponse, RunChange } from '@spark-outpost/contracts';
import { insertFinishedRunEntries } from '../persistence/audit-log.ts';
import { branchesStackedOn } from '../persistence/chat-worktrees.ts';
import { withTransaction, type Db, type Queryable } from '../persistence/db.ts';
import {
  chatHasWorkingRun,
  lockRun,
  saveFileReverts,
  type NewFileRevert,
} from '../persistence/file-reverts.ts';
import {
  getSnapshot,
  listBackupEnds,
  listBackups,
  type FileBackup,
} from '../persistence/run-snapshots.ts';
import { getTaskDetail } from '../persistence/task-views.ts';
import { TaskNotFoundError } from '../persistence/tasks.ts';
import { findEntry, type ChangeSet, type SetEntry } from './change-sets.ts';
import { isSecretPath, protectedPath, relativeInside } from './path-policy.ts';
import { readIgnore } from './project-fs.ts';
import { publishedState } from './published-state.ts';
import {
  REMOVED_FOLDER_REASON,
  RevertConflictError,
  readIfPresent,
  restoreBackups,
} from './run-changes.ts';
import { runBaseUntil } from './run-base.ts';
import { blobAt, revertGitChanges, worktreeBlob } from './snapshot.ts';
import { gitRunBounds, runStates, type RunState } from './task-changes.ts';

const REASONS = {
  gone: 'That file has no changes in this run any more.',
  copy: 'This change was brought in from a copy. Revert it in your checkout.',
  reverted: 'This run was already reverted.',
  working: 'The chat is still working. Revert the file when the turn ends.',
  outside: 'That file is outside this chat’s project.',
  already: 'This file was already reverted.',
  changedAfter:
    'This file changed after this run. Revert the later change first, or edit the file yourself.',
  noSnapshot: 'This run made no snapshot.',
};

type ProtectedKind = FileRevertCheck['protectedKind'];

interface GitSource {
  kind: 'git';
  base: string;
  current: ReadonlyMap<string, string | null>;
  original: ReadonlyMap<string, string | null>;
  snapshotRef: string;
}

interface FilesSource {
  kind: 'files';
  backups: readonly FileBackup[];
}

interface RevertPlan {
  entry: SetEntry;
  root: string;
  targets: RunChange[];
  source: GitSource | FilesSource | null;
  reason: string | null;
}

export function revertTargets(file: RunChange & { oldPath?: string | undefined }): RunChange[] {
  if (file.oldPath === undefined) return [{ path: file.path, change: file.change }];
  return [
    { path: file.oldPath, change: 'deleted' },
    { path: file.path, change: 'added' },
  ];
}

async function realAncestor(target: string): Promise<string> {
  const real = await realpath(target).catch(() => null);
  if (real !== null) return real;
  const parent = path.dirname(target);
  return parent === target ? target : realAncestor(parent);
}

export async function staysInside(root: string, relative: string): Promise<boolean> {
  const target = path.resolve(root, relative);
  if (relativeInside(root, target) === null) return false;
  if (relative.split('/')[0] === '.git' || protectedPath(relative) === 'git_control') return false;
  const [realRoot, realParent] = await Promise.all([
    realpath(root),
    realAncestor(path.dirname(target)),
  ]);
  return realParent === realRoot || relativeInside(realRoot, realParent) !== null;
}

async function runContext(db: Queryable, workspaceId: string, taskId: string, runId: string) {
  const task = await getTaskDetail(db, taskId);
  if (!task) throw new TaskNotFoundError(taskId);
  const states = await runStates(db, workspaceId, task.runIds);
  const index = states.findIndex((state) => state.runId === runId);
  const run = states[index];
  if (!run) throw new RevertConflictError(REASONS.noSnapshot);
  const later = states
    .slice(index + 1)
    .filter((other) => other.snapshot.root === run.snapshot.root);
  return { run, later };
}

function listedBlob(entry: SetEntry, relative: string): string | null | undefined {
  const blobs = entry.listed.blobs;
  if (!blobs) return undefined;
  return relative === entry.listed.file.path ? blobs.after : null;
}

async function blobsAt(root: string, ref: string | null, targets: readonly RunChange[]) {
  const blobs = new Map<string, string | null>();
  for (const target of targets) {
    blobs.set(target.path, ref ? await blobAt(root, ref, target.path) : null);
  }
  return blobs;
}

async function gitSource(
  db: Queryable,
  entry: SetEntry,
  run: RunState,
  later: readonly RunState[],
  endRef: string | null,
  targets: readonly RunChange[],
): Promise<{ source: GitSource | null; reason: string | null }> {
  const snapshotRef = run.snapshot.ref;
  const next = later.find((other) => other.snapshot.kind === 'git');
  const bounds = await gitRunBounds(db, run, next);
  if (!snapshotRef || !bounds || bounds.gone)
    return { source: null, reason: REMOVED_FOLDER_REASON };
  const root = run.snapshot.root;
  const stacked = await branchesStackedOn(db, root);
  const base = await runBaseUntil(root, snapshotRef, bounds.until, stacked);
  const end = endRef ?? next?.snapshot.ref ?? null;
  const original = await blobsAt(root, base, targets);
  const ended = end ? await blobsAt(root, end, targets) : null;
  const current = new Map<string, string | null>();
  for (const target of targets) current.set(target.path, await worktreeBlob(root, target.path));
  const source: GitSource = { kind: 'git', base, current, original, snapshotRef };
  const restored = targets.every((t) => current.get(t.path) === original.get(t.path));
  if (restored) return { source, reason: REASONS.already };
  const moved = targets.some((target) => {
    const expected = ended ? ended.get(target.path) : listedBlob(entry, target.path);
    return expected !== undefined && current.get(target.path) !== expected;
  });
  return { source, reason: moved ? REASONS.changedAfter : null };
}

async function filesSource(
  db: Queryable,
  run: RunState,
  later: readonly RunState[],
  targets: readonly RunChange[],
): Promise<{ source: FilesSource | null; reason: string | null }> {
  const root = run.snapshot.root;
  const wanted = new Set(targets.map((target) => path.join(root, target.path)));
  const backups = (await listBackups(db, run.runId)).filter((backup) => wanted.has(backup.path));
  if (backups.length !== wanted.size) return { source: null, reason: REASONS.gone };
  const current = new Map<string, Buffer | null>();
  for (const backup of backups) current.set(backup.path, await readIfPresent(backup.path));
  const restored = backups.every((backup) =>
    sameContent(current.get(backup.path) ?? null, backup.existed ? backup.content : null),
  );
  const source: FilesSource = { kind: 'files', backups };
  if (restored) return { source, reason: REASONS.already };
  const moved = await changedSinceRun(db, run.runId, later, wanted, current);
  return { source, reason: moved ? REASONS.changedAfter : null };
}

function sameContent(left: Buffer | null, right: Buffer | null): boolean {
  if (left === null || right === null) return left === right;
  return left.equals(right);
}

async function changedSinceRun(
  db: Queryable,
  runId: string,
  later: readonly RunState[],
  wanted: ReadonlySet<string>,
  current: ReadonlyMap<string, Buffer | null>,
): Promise<boolean> {
  const ends = (await listBackupEnds(db, runId)).filter((end) => wanted.has(end.path));
  if (ends.length === wanted.size) {
    return ends.some((end) => !sameContent(current.get(end.path) ?? null, end.content));
  }
  for (const other of later) {
    const touched = (await listBackups(db, other.runId)).some((backup) => wanted.has(backup.path));
    if (touched) return true;
  }
  return false;
}

const folderExists = (target: string) =>
  access(target).then(
    () => true,
    () => false,
  );

async function guardReason(
  db: Queryable,
  set: ChangeSet,
  entry: SetEntry,
  revertedAt: Date | null,
  targets: readonly RunChange[],
): Promise<string | null> {
  if (set.runs.find((run) => run.runId === entry.runId)?.copy) return REASONS.copy;
  if (revertedAt) return REASONS.reverted;
  if (await chatHasWorkingRun(db, entry.runId)) return REASONS.working;
  if (!(await folderExists(entry.root))) return REMOVED_FOLDER_REASON;
  for (const target of targets) {
    if (!(await staysInside(entry.root, target.path))) return REASONS.outside;
  }
  return null;
}

async function planFileRevert(
  db: Queryable,
  workspaceId: string,
  set: ChangeSet,
  runId: string,
  relative: string,
): Promise<RevertPlan> {
  const entry = findEntry(set, runId, relative);
  if (!entry) throw new RevertConflictError(REASONS.gone);
  const state = await getSnapshot(db, workspaceId, runId);
  if (!state?.snapshot) throw new RevertConflictError(REASONS.noSnapshot);
  const targets = revertTargets(entry.listed.file);
  const root = state.snapshot.root;
  const blocked = await guardReason(db, set, entry, state.revertedAt, targets);
  if (blocked) return { entry, root, targets, source: null, reason: blocked };
  const { run, later } = await runContext(db, workspaceId, set.taskId, runId);
  const found =
    run.snapshot.kind === 'git'
      ? await gitSource(db, entry, run, later, state.endRef, targets)
      : await filesSource(db, run, later, targets);
  return { entry, root, targets, ...found };
}

async function protectedKindOf(
  root: string,
  targets: readonly RunChange[],
): Promise<ProtectedKind> {
  const ignore = await readIgnore(root);
  let kind: ProtectedKind = null;
  for (const target of targets) {
    if (isSecretPath(target.path, ignore)) return 'secret';
    if (protectedPath(target.path) === 'instructions') kind = 'instructions';
  }
  return kind;
}

async function planFacts(plan: RevertPlan) {
  const published =
    plan.source?.kind === 'git'
      ? await publishedState(plan.root, plan.source.snapshotRef, plan.source.current)
      : { committed: false, pushed: false };
  return { protectedKind: await protectedKindOf(plan.root, plan.targets), ...published };
}

export async function fileRevertCheck(
  db: Queryable,
  workspaceId: string,
  set: ChangeSet,
  runId: string,
  relative: string,
): Promise<FileRevertCheck> {
  const plan = await planFileRevert(db, workspaceId, set, runId, relative);
  const { file } = plan.entry.listed;
  return {
    path: file.path,
    ...(file.oldPath === undefined ? {} : { oldPath: file.oldPath }),
    change: file.change,
    revertible: plan.reason === null,
    reason: plan.reason,
    ...(await planFacts(plan)),
  };
}

function revertRows({ source, targets }: RevertPlan): NewFileRevert[] {
  return targets.map((target) => ({
    path: target.path,
    beforeBlob: source?.kind === 'git' ? (source.current.get(target.path) ?? null) : null,
    afterBlob: source?.kind === 'git' ? (source.original.get(target.path) ?? null) : null,
  }));
}

async function applyPlan({ source, targets, root }: RevertPlan): Promise<void> {
  if (source?.kind === 'git') await revertGitChanges(root, source.base, targets);
  if (source?.kind === 'files') await restoreBackups(source.backups.map((backup) => ({ backup })));
}

async function auditFileRevert(db: Db, runId: string, plan: RevertPlan): Promise<void> {
  const { file } = plan.entry.listed;
  const payload = {
    path: file.path,
    oldPath: file.oldPath ?? null,
    change: file.change,
    restored: plan.targets,
    ...(await planFacts(plan)),
  };
  await insertFinishedRunEntries(db, runId, [
    {
      at: new Date(),
      direction: 'harness',
      kind: 'revert',
      method: 'spark/revert_file',
      rpcId: null,
      sizeBytes: Buffer.byteLength(JSON.stringify(payload)),
      truncated: false,
      payload,
    },
  ]);
}

export async function revertFile(
  db: Db,
  workspaceId: string,
  set: ChangeSet,
  runId: string,
  relative: string,
): Promise<FileRevertResponse> {
  const done = await withTransaction(db, async (client) => {
    await lockRun(client, runId);
    const plan = await planFileRevert(client, workspaceId, set, runId, relative);
    if (plan.reason) throw new RevertConflictError(plan.reason);
    const revertedAt = await saveFileReverts(client, runId, revertRows(plan));
    await applyPlan(plan);
    return { plan, revertedAt };
  });
  await auditFileRevert(db, runId, done.plan);
  return { restored: done.plan.targets, revertedAt: done.revertedAt.toISOString() };
}
