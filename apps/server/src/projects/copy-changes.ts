import type { Queryable } from '../persistence/db.ts';
import { worktreesForRuns, type WorktreeRecord } from '../persistence/worktrees.ts';
import { gitRangeFiles } from './change-list.ts';
import type { ListedRun } from './task-changes.ts';

export interface CopyChanges {
  changes: ListedRun | null;
  mergedInto: string | null;
}

async function describeCopy(
  record: WorktreeRecord & { name: string | null },
): Promise<ListedRun | null> {
  const { resultCommit } = record;
  if (!resultCommit) return null;
  const files = await gitRangeFiles({
    root: record.repoRoot,
    from: record.baseCommit,
    to: resultCommit,
  }).catch(() => []);
  if (files.length === 0) return null;
  return {
    runId: record.runId,
    root: record.repoRoot,
    revertedAt: null,
    files,
    ...(record.name ? { name: record.name } : {}),
    copy: record.branch,
  };
}

export async function copyChanges(
  db: Queryable,
  runIds: readonly string[],
): Promise<Map<string, CopyChanges>> {
  const records = await worktreesForRuns(db, runIds);
  const entries = await Promise.all(
    [...records.values()].map(async (record): Promise<[string, CopyChanges]> => [
      record.runId,
      {
        changes: await describeCopy(record),
        mergedInto: record.mergedAt ? record.repoRoot : null,
      },
    ]),
  );
  return new Map(entries);
}
