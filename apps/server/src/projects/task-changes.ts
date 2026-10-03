import path from 'node:path';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { diffLines } from 'diff';
import {
  CHANGED_FILE_FULL_MAX_BYTES,
  CHANGED_FILE_TEXT_MAX_BYTES,
  type ChangedFile,
  type ChangedFileQuery,
  type RunChange,
  type RunFileChanges,
  type TaskChanges,
} from '@spark-outpost/contracts';
import { mapLimit } from '../codescan/file-stats.ts';
import type { Queryable } from '../persistence/db.ts';
import { getSnapshot, listBackups, type RunSnapshot } from '../persistence/run-snapshots.ts';
import { getTaskDetail } from '../persistence/task-views.ts';
import { TaskNotFoundError } from '../persistence/tasks.ts';
import { pairRenames } from './change-renames.ts';
import { copyChanges, type Describe } from './copy-changes.ts';
import { countChangedLines, lineCount, type LineCounts } from './line-counts.ts';
import { relativeInside } from './path-policy.ts';
import {
  changesWhilePresent,
  readIfPresent,
  snapshotSource,
  type SnapshotSource,
} from './run-changes.ts';
import { runBaseUntil } from './run-base.ts';
import { gitChanges, gitFileAt } from './snapshot.ts';

const GIT_READ_CONCURRENCY = 8;
const DIFF_TIMEOUT_MS = 50;

interface FileVersions {
  change: RunChange;
  before: Buffer | null;
  after: Buffer | null;
}

function isBinary(content: Buffer | null): boolean {
  return content !== null && content.includes(0);
}

function isTooLarge(content: Buffer | null, maxBytes: number): boolean {
  return content !== null && content.length > maxBytes;
}

function describer(fullPath: string | null): Describe {
  return async ({ change, before, after }: FileVersions): Promise<ChangedFile> => {
    const maxBytes =
      change.path === fullPath ? CHANGED_FILE_FULL_MAX_BYTES : CHANGED_FILE_TEXT_MAX_BYTES;
    const base = { ...change, added: null, removed: null, oldText: null, newText: null };
    if (isBinary(before) || isBinary(after)) return { ...base, shown: 'binary' };
    if (isTooLarge(before, maxBytes) || isTooLarge(after, maxBytes)) {
      const counts = await countChangedLines(before, after);
      return { ...base, ...counts, shown: 'too-large', truncated: true };
    }
    const oldText = before?.toString('utf8') ?? null;
    const newText = after?.toString('utf8') ?? null;
    const counts = await textCounts(before, after, oldText, newText);
    return { ...change, ...counts, oldText, newText, shown: 'text' };
  };
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

interface RunState {
  runId: string;
  snapshot: RunSnapshot;
  revertedAt: Date | null;
}

function changeKind(before: Buffer | null, after: Buffer | null): RunChange['change'] | null {
  if (before === null) return after === null ? null : 'added';
  if (after === null) return 'deleted';
  return before.equals(after) ? null : 'modified';
}

async function gitVersions(
  db: Queryable,
  run: RunState,
  next: RunState | undefined,
): Promise<FileVersions[]> {
  const { root, ref } = run.snapshot;
  if (!ref) return [];
  const source = await snapshotSource(db, run.runId, root);
  const until = next?.snapshot.ref ?? source.end;
  if (source.gone && !until) return [];
  const gitRoot = source.gitRoot;
  const base = await runBaseUntil(gitRoot, ref, until);
  const changes = await changesWhilePresent(gitRoot, () => gitChanges(gitRoot, base, until));
  if (changes === null) return [];
  const afterContent = (change: RunChange): Promise<Buffer | null> => {
    if (change.change === 'deleted') return Promise.resolve(null);
    if (until) return gitFileAt(gitRoot, until, change.path);
    return readIfPresent(path.join(root, change.path));
  };
  return mapLimit(changes, GIT_READ_CONCURRENCY, async (change) => ({
    change,
    before: change.change === 'added' ? null : await gitFileAt(gitRoot, base, change.path),
    after: await afterContent(change),
  }));
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

async function runStates(
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

async function runFiles(
  db: Queryable,
  run: RunState,
  later: readonly RunState[],
  describe: Describe,
): Promise<RunFileChanges | null> {
  const sameRoot = later.filter((other) => other.snapshot.root === run.snapshot.root);
  const versions =
    run.snapshot.kind === 'git'
      ? await gitVersions(
          db,
          run,
          sameRoot.find((other) => other.snapshot.kind === 'git'),
        )
      : await backupVersions(db, run, sameRoot);
  if (versions.length === 0) return null;
  return {
    runId: run.runId,
    revertedAt: run.revertedAt?.toISOString() ?? null,
    files: await mapLimit(versions, GIT_READ_CONCURRENCY, describe),
  };
}

function withRenames(run: RunFileChanges): RunFileChanges {
  return { ...run, files: pairRenames(run.files) };
}

export async function taskChanges(
  db: Queryable,
  workspaceId: string,
  taskId: string,
  fullPath: string | null = null,
): Promise<TaskChanges> {
  const task = await getTaskDetail(db, taskId);
  if (!task) throw new TaskNotFoundError(taskId);
  const describe = describer(fullPath);
  const copies = await copyChanges(db, task.runIds, describe);
  const states = (await runStates(db, workspaceId, task.runIds)).filter(
    (state) =>
      !copies.has(state.runId) || copies.get(state.runId)?.mergedInto === state.snapshot.root,
  );
  const main = await Promise.all(
    states.map((run, index) =>
      copies.has(run.runId) ? null : runFiles(db, run, states.slice(index + 1), describe),
    ),
  );
  const byRun = new Map(
    [...main, ...[...copies.values()].map((copy) => copy.changes)].flatMap((run) =>
      run ? [[run.runId, withRenames(run)] as const] : [],
    ),
  );
  return { runs: task.runIds.flatMap((runId) => byRun.get(runId) ?? []) };
}

export async function taskChangedFile(
  db: Queryable,
  workspaceId: string,
  taskId: string,
  query: ChangedFileQuery,
): Promise<ChangedFile | null> {
  const changes = await taskChanges(db, workspaceId, taskId, query.path);
  const run = changes.runs.find((candidate) => candidate.runId === query.runId);
  return run?.files.find((file) => file.path === query.path) ?? null;
}
