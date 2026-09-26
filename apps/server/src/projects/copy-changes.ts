import type { ChangedFile, RunChange, RunFileChanges } from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';
import { worktreesForRuns, type WorktreeRecord } from '../persistence/worktrees.ts';
import { gitChanges, gitFileAt } from './snapshot.ts';

export type Describe = (versions: {
  change: RunChange;
  before: Buffer | null;
  after: Buffer | null;
}) => Promise<ChangedFile>;

export interface CopyChanges {
  changes: RunFileChanges | null;
  mergedInto: string | null;
}

async function copyFiles(
  record: WorktreeRecord & { resultCommit: string },
  describe: Describe,
): Promise<ChangedFile[]> {
  const { repoRoot: root, baseCommit: base, resultCommit: result } = record;
  const changes = await gitChanges(root, base, result);
  return Promise.all(
    changes.map(async (change) =>
      describe({
        change,
        before: change.change === 'added' ? null : await gitFileAt(root, base, change.path),
        after: change.change === 'deleted' ? null : await gitFileAt(root, result, change.path),
      }),
    ),
  );
}

async function describeCopy(
  record: WorktreeRecord & { name: string | null },
  describe: Describe,
): Promise<RunFileChanges | null> {
  const { resultCommit } = record;
  if (!resultCommit) return null;
  const files = await copyFiles({ ...record, resultCommit }, describe).catch(() => []);
  if (files.length === 0) return null;
  return {
    runId: record.runId,
    revertedAt: null,
    files,
    ...(record.name ? { name: record.name } : {}),
    copy: record.branch,
  };
}

export async function copyChanges(
  db: Queryable,
  runIds: readonly string[],
  describe: Describe,
): Promise<Map<string, CopyChanges>> {
  const records = await worktreesForRuns(db, runIds);
  const entries = await Promise.all(
    [...records.values()].map(async (record): Promise<[string, CopyChanges]> => [
      record.runId,
      {
        changes: await describeCopy(record, describe),
        mergedInto: record.mergedAt ? record.repoRoot : null,
      },
    ]),
  );
  return new Map(entries);
}
