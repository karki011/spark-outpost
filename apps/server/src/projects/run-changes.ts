import { access, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  isTerminalRunStatus,
  runStatusSchema,
  type RevertRunResponse,
  type RunChange,
  type RunChanges,
} from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';
import {
  clearReverted,
  getSnapshot,
  listBackups,
  markReverted,
  saveBackup,
  saveSnapshot,
  type FileBackup,
  type RunSnapshot,
} from '../persistence/run-snapshots.ts';
import { laneOfRun } from '../persistence/worktrees.ts';
import { relativeInside } from './path-policy.ts';
import { liveRunBase, runBaseUntil } from './run-base.ts';
import { gitChanges, isGitWorkTree, revertGitChanges, takeGitSnapshot } from './snapshot.ts';

export class RunNotFoundError extends Error {
  constructor() {
    super('Run not found.');
  }
}

export class RevertConflictError extends Error {}

const REMOVED_FOLDER_REASON =
  'The folder this run worked in was removed, so it cannot be reverted on its own.';

export interface SnapshotSource {
  gitRoot: string;
  end: string | null;
  gone: boolean;
}

function exists(target: string): Promise<boolean> {
  return access(target).then(
    () => true,
    () => false,
  );
}

export async function changesWhilePresent(
  root: string,
  read: () => Promise<RunChange[]>,
): Promise<RunChange[] | null> {
  try {
    return await read();
  } catch (error) {
    if (await repoStillThere(root)) throw error;
    return null;
  }
}

export async function repoStillThere(root: string): Promise<boolean> {
  return (await exists(root)) && (await isGitWorkTree(root));
}

export async function snapshotSource(
  db: Queryable,
  runId: string,
  root: string,
): Promise<SnapshotSource> {
  if (await exists(root)) return { gitRoot: root, end: null, gone: false };
  const lane = await laneOfRun(db, runId);
  return { gitRoot: lane?.repoRoot ?? root, end: lane?.resultCommit ?? null, gone: true };
}

export async function snapshotRun(
  db: Queryable,
  runId: string,
  root: string,
): Promise<RunSnapshot> {
  const snapshot: RunSnapshot = (await isGitWorkTree(root))
    ? { kind: 'git', ref: await takeGitSnapshot(root, runId), root }
    : { kind: 'files', ref: null, root };
  await saveSnapshot(db, runId, snapshot);
  return snapshot;
}

export async function readIfPresent(target: string): Promise<Buffer | null> {
  try {
    return await readFile(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function backupBeforeEdit(
  db: Queryable,
  runId: string,
  snapshot: RunSnapshot,
  targets: readonly string[],
): Promise<void> {
  if (snapshot.kind !== 'files') return;
  for (const target of targets) {
    if (relativeInside(snapshot.root, target) === null) continue;
    const content = await readIfPresent(target);
    await saveBackup(db, runId, { path: target, existed: content !== null, content });
  }
}

async function fileChange(backup: FileBackup): Promise<RunChange['change'] | null> {
  const current = await readIfPresent(backup.path);
  if (!backup.existed) return current === null ? null : 'added';
  if (current === null) return 'deleted';
  return backup.content && current.equals(backup.content) ? null : 'modified';
}

async function backupChanges(
  backups: readonly FileBackup[],
  root: string,
): Promise<{ change: RunChange; backup: FileBackup }[]> {
  const changes: { change: RunChange; backup: FileBackup }[] = [];
  for (const backup of backups) {
    const change = await fileChange(backup);
    const relative = relativeInside(root, backup.path);
    if (change && relative) changes.push({ change: { path: relative, change }, backup });
  }
  return changes;
}

async function loadState(db: Queryable, workspaceId: string, runId: string) {
  const state = await getSnapshot(db, workspaceId, runId);
  if (!state) throw new RunNotFoundError();
  return state;
}

function unrevertibleReason(run: {
  working: boolean;
  revertedAt: string | null;
  files: readonly RunChange[];
}): string | null {
  if (run.working) return 'The run is still working.';
  if (run.revertedAt) return 'This run was already reverted.';
  if (run.files.length === 0) return 'No files changed since the run started.';
  return null;
}

export async function runChanges(
  db: Queryable,
  workspaceId: string,
  runId: string,
  live = false,
): Promise<RunChanges> {
  const state = await loadState(db, workspaceId, runId);
  const revertedAt = state.revertedAt?.toISOString() ?? null;
  const { snapshot } = state;
  if (!snapshot) {
    return { revertible: false, revertedAt, files: [], reason: 'This run made no snapshot.' };
  }
  const removed = (files: RunChange[]): RunChanges => ({
    revertible: false,
    revertedAt,
    files,
    reason: REMOVED_FOLDER_REASON,
  });
  const { ref } = snapshot;
  const source = await snapshotSource(db, runId, snapshot.root);
  if (source.gone) {
    const end = source.end;
    if (snapshot.kind !== 'git' || !ref || !end) return removed([]);
    const files = await changesWhilePresent(source.gitRoot, async () =>
      gitChanges(source.gitRoot, await runBaseUntil(source.gitRoot, ref, end), end),
    );
    return removed(files ?? []);
  }
  const files =
    snapshot.kind === 'git' && ref
      ? await changesWhilePresent(snapshot.root, async () =>
          gitChanges(snapshot.root, await liveRunBase(snapshot.root, ref)),
        )
      : (await backupChanges(await listBackups(db, runId), snapshot.root)).map((c) => c.change);
  if (files === null) return removed([]);
  const status = runStatusSchema.parse(state.status);
  const reason = unrevertibleReason({
    working: !live && !isTerminalRunStatus(status),
    revertedAt,
    files,
  });
  return { revertible: reason === null, revertedAt, files, reason };
}

export async function revertRun(
  db: Queryable,
  workspaceId: string,
  runId: string,
  live = false,
): Promise<RevertRunResponse> {
  const changes = await runChanges(db, workspaceId, runId, live);
  if (!changes.revertible) {
    throw new RevertConflictError(changes.reason ?? 'This run cannot be reverted.');
  }
  const { snapshot } = await loadState(db, workspaceId, runId);
  if (!snapshot) throw new RevertConflictError('This run made no snapshot.');
  const revertedAt = await markReverted(db, runId);
  if (!revertedAt) throw new RevertConflictError('This run was already reverted.');
  try {
    if (snapshot.kind === 'git' && snapshot.ref) {
      const base = await liveRunBase(snapshot.root, snapshot.ref);
      await revertGitChanges(snapshot.root, base, changes.files);
    } else {
      await restoreBackups(await backupChanges(await listBackups(db, runId), snapshot.root));
    }
  } catch (error) {
    await clearReverted(db, runId);
    throw error;
  }
  return { restored: changes.files, revertedAt: revertedAt.toISOString() };
}

async function restoreBackups(changes: readonly { backup: FileBackup }[]): Promise<void> {
  for (const { backup } of changes) {
    if (!backup.existed || !backup.content) {
      await unlink(backup.path).catch(() => undefined);
      continue;
    }
    await mkdir(path.dirname(backup.path), { recursive: true });
    await writeFile(backup.path, backup.content);
  }
}
