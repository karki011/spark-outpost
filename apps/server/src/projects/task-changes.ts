import { setImmediate as nextTurn } from 'node:timers/promises';
import { diffLines } from 'diff';
import type { ChangedFile, RevertedFile, RunChange, TaskChanges } from '@spark-outpost/contracts';
import { branchesStackedOn } from '../persistence/chat-worktrees.ts';
import type { Queryable } from '../persistence/db.ts';
import { listFileReverts, type FileRevert } from '../persistence/file-reverts.ts';
import { getSnapshot, listBackups, type RunSnapshot } from '../persistence/run-snapshots.ts';
import { getTaskDetail } from '../persistence/task-views.ts';
import { TaskNotFoundError } from '../persistence/tasks.ts';
import { pairRenames } from './change-renames.ts';
import { gitRangeFiles, shownFor, type FileContents, type ListedFile } from './change-list.ts';
import { copyChanges } from './copy-changes.ts';
import { countChangedLines, lineCount, type LineCounts } from './line-counts.ts';
import { relativeInside } from './path-policy.ts';
import { revertedFiles, revertsByPath, withoutReverted } from './revert-filter.ts';
import {
  changesWhilePresent,
  readIfPresent,
  snapshotSource,
  type SnapshotSource,
} from './run-changes.ts';
import { runBaseUntil } from './run-base.ts';
import { rangeSignature, type RunListingCache } from './run-listing-cache.ts';
import { gitFileAt, workingTree } from './snapshot.ts';

export interface ListedRun {
  runId: string;
  root: string;
  revertedAt: string | null;
  name?: string;
  copy?: string;
  files: ListedFile[];
  reverted?: RevertedFile[];
}

interface FileVersions extends FileContents {
  change: RunChange;
}

function isBinary(content: Buffer | null): boolean {
  return content !== null && content.includes(0);
}

function byteSize(versions: FileContents): number {
  return Math.max(versions.before?.length ?? 0, versions.after?.length ?? 0);
}

async function describeVersions(versions: FileVersions): Promise<ChangedFile> {
  const { change, before, after } = versions;
  const bytes = byteSize(versions);
  const base = { ...change, added: null, removed: null, oldText: null, newText: null, bytes };
  if (isBinary(before) || isBinary(after)) return { ...base, shown: 'binary' };
  if (shownFor(false, bytes) === 'too-large') {
    const counts = await countChangedLines(before, after);
    return { ...base, ...counts, shown: 'too-large', truncated: true };
  }
  const oldText = before?.toString('utf8') ?? null;
  const newText = after?.toString('utf8') ?? null;
  const counts = await textCounts(before, after, oldText, newText);
  return { ...change, ...counts, oldText, newText, shown: 'text', bytes };
}

async function textCounts(
  before: Buffer | null,
  after: Buffer | null,
  oldText: string | null,
  newText: string | null,
): Promise<LineCounts> {
  if (oldText === null || newText === null) {
    return { added: lineCount(after), removed: lineCount(before) };
  }
  await nextTurn();
  const parts = diffLines(oldText, newText, { timeout: DIFF_TIMEOUT_MS });
  if (!parts) return countChangedLines(before, after);
  let added = 0;
  let removed = 0;
  for (const part of parts) {
    if (part.added) added += part.count;
    if (part.removed) removed += part.count;
  }
  return { added, removed };
}

function withoutText(file: ChangedFile): ChangedFile {
  return { ...file, oldText: null, newText: null };
}

const DIFF_TIMEOUT_MS = 50;

export interface RunState {
  runId: string;
  snapshot: RunSnapshot;
  revertedAt: Date | null;
}

function changeKind(before: Buffer | null, after: Buffer | null): RunChange['change'] | null {
  if (before === null) return after === null ? null : 'added';
  if (after === null) return 'deleted';
  return before.equals(after) ? null : 'modified';
}

export interface GitRunBounds {
  gitRoot: string;
  until: string | null;
  gone: boolean;
}

export async function gitRunBounds(
  db: Queryable,
  run: RunState,
  next: RunState | undefined,
): Promise<GitRunBounds | null> {
  const { root, ref } = run.snapshot;
  if (!ref) return null;
  const source = await snapshotSource(db, run.runId, root);
  const until = next?.snapshot.ref ?? source.end;
  if (source.gone && !until) return null;
  return { gitRoot: source.gitRoot, until, gone: source.gone };
}

async function gitListed(
  db: Queryable,
  run: RunState,
  next: RunState | undefined,
  listings: RunListingCache | undefined,
): Promise<{ files: ListedFile[]; fixedRange: boolean }> {
  const ref = run.snapshot.ref;
  const bounds = await gitRunBounds(db, run, next);
  if (!ref || !bounds) return { files: [], fixedRange: false };
  const { gitRoot, until } = bounds;
  const fixedRange = until !== null;
  const range = { root: gitRoot, from: ref, until };
  const signature = listings ? await rangeSignature(range) : null;
  const known = signature === null ? undefined : listings?.get(signature);
  if (known) return { files: known, fixedRange };
  const stacked = await branchesStackedOn(db, run.snapshot.root);
  const base = await runBaseUntil(gitRoot, ref, until, stacked);
  const files = await changesWhilePresent(gitRoot, async () =>
    gitRangeFiles({ root: gitRoot, from: base, to: until ?? (await workingTree(gitRoot)) }),
  );
  if (files && signature !== null && (await rangeSignature(range)) === signature) {
    listings?.set(signature, files);
  }
  return { files: files ?? [], fixedRange };
}

async function laterBackup(
  db: Queryable,
  later: readonly RunState[],
  target: string,
): Promise<{ found: boolean; content: Buffer | null }> {
  for (const run of later) {
    const backup = (await listBackups(db, run.runId)).find((entry) => entry.path === target);
    if (backup) return { found: true, content: backup.existed ? backup.content : null };
  }
  return { found: false, content: null };
}

async function currentContent(
  source: SnapshotSource,
  target: string,
  relative: string,
  before: Buffer | null,
): Promise<Buffer | null> {
  if (!source.gone) return readIfPresent(target);
  return source.end ? gitFileAt(source.gitRoot, source.end, relative) : before;
}

async function backupVersions(
  db: Queryable,
  run: RunState,
  later: readonly RunState[],
): Promise<FileVersions[]> {
  const versions: FileVersions[] = [];
  const source = await snapshotSource(db, run.runId, run.snapshot.root);
  for (const backup of await listBackups(db, run.runId)) {
    const relative = relativeInside(run.snapshot.root, backup.path);
    if (relative === null) continue;
    const before = backup.existed ? backup.content : null;
    const next = await laterBackup(db, later, backup.path);
    const after = next.found
      ? next.content
      : await currentContent(source, backup.path, relative, before);
    const change = changeKind(before, after);
    if (change) versions.push({ change: { path: relative, change }, before, after });
  }
  return versions;
}

async function backupListed(
  db: Queryable,
  run: RunState,
  later: readonly RunState[],
): Promise<ListedFile[]> {
  const versions = await backupVersions(db, run, later);
  const byPath = new Map(versions.map((version) => [version.change.path, version]));
  const described: ChangedFile[] = [];
  for (const version of versions) described.push(await describeVersions(version));
  const files = await pairRenames(described);
  return files.map((file) => ({
    file: withoutText(file),
    contents: () =>
      Promise.resolve({
        before: byPath.get(file.oldPath ?? file.path)?.before ?? null,
        after: byPath.get(file.path)?.after ?? null,
      }),
  }));
}

export async function runStates(
  db: Queryable,
  workspaceId: string,
  runIds: readonly string[],
): Promise<RunState[]> {
  const states = await Promise.all(
    runIds.map(async (runId) => ({ runId, state: await getSnapshot(db, workspaceId, runId) })),
  );
  return states.flatMap(({ runId, state }) =>
    state?.snapshot ? [{ runId, snapshot: state.snapshot, revertedAt: state.revertedAt }] : [],
  );
}

interface RunContext {
  later: readonly RunState[];
  earlier: readonly RunState[];
  reverts: readonly FileRevert[];
}

function revertsOf(reverts: readonly FileRevert[], runs: readonly RunState[]): FileRevert[] {
  const ids = new Set(runs.map((run) => run.runId));
  return reverts.filter((revert) => ids.has(revert.runId));
}

async function runFiles(
  db: Queryable,
  run: RunState,
  context: RunContext,
  listings: RunListingCache | undefined,
): Promise<ListedRun | null> {
  const sameRoot = (other: RunState) => other.snapshot.root === run.snapshot.root;
  const later = context.later.filter(sameRoot);
  const own = revertsOf(context.reverts, [run]);
  let files: ListedFile[];
  if (run.snapshot.kind === 'git') {
    const listed = await gitListed(
      db,
      run,
      later.find((other) => other.snapshot.kind === 'git'),
      listings,
    );
    const earlier = revertsByPath(revertsOf(context.reverts, context.earlier.filter(sameRoot)));
    files = withoutReverted(listed.files, { own, earlier, fixedRange: listed.fixedRange });
  } else {
    files = await backupListed(db, run, later);
  }
  if (files.length === 0 && own.length === 0) return null;
  return {
    runId: run.runId,
    root: run.snapshot.root,
    revertedAt: run.revertedAt?.toISOString() ?? null,
    files,
    ...(own.length > 0 ? { reverted: revertedFiles(own) } : {}),
  };
}

export async function taskChangeSet(
  db: Queryable,
  workspaceId: string,
  taskId: string,
  listings?: RunListingCache,
): Promise<ListedRun[]> {
  const task = await getTaskDetail(db, taskId);
  if (!task) throw new TaskNotFoundError(taskId);
  const copies = await copyChanges(db, task.runIds);
  const states = (await runStates(db, workspaceId, task.runIds)).filter(
    (state) =>
      !copies.has(state.runId) || copies.get(state.runId)?.mergedInto === state.snapshot.root,
  );
  const reverts = await listFileReverts(
    db,
    states.map((state) => state.runId),
  );
  const main = await Promise.all(
    states.map((run, index) =>
      copies.has(run.runId)
        ? null
        : runFiles(
            db,
            run,
            { later: states.slice(index + 1), earlier: states.slice(0, index), reverts },
            listings,
          ),
    ),
  );
  const byRun = new Map(
    [...main, ...[...copies.values()].map((copy) => copy.changes)].flatMap((run) =>
      run ? [[run.runId, run] as const] : [],
    ),
  );
  return task.runIds.flatMap((runId) => byRun.get(runId) ?? []);
}

export function leanChanges(runs: readonly ListedRun[]): TaskChanges {
  return {
    runs: runs.map(({ runId, revertedAt, name, copy, files }) => ({
      runId,
      revertedAt,
      ...(name ? { name } : {}),
      ...(copy ? { copy } : {}),
      files: files.map((entry) => entry.file),
    })),
  };
}

export async function taskChanges(
  db: Queryable,
  workspaceId: string,
  taskId: string,
): Promise<TaskChanges> {
  return leanChanges(await taskChangeSet(db, workspaceId, taskId));
}
