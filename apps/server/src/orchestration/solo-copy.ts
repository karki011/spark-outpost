import type { Db } from '../persistence/db.ts';
import { markRemoved, orphanedWorktrees, type WorktreeRecord } from '../persistence/worktrees.ts';
import { settleDepsPrep } from '../projects/deps-prep.ts';
import { removeWorktree, worktreePath } from '../projects/worktrees.ts';

async function removeCopy(db: Db, record: WorktreeRecord): Promise<void> {
  await settleDepsPrep(record.runId);
  await removeWorktree(record.repoRoot, worktreePath(record.repoRoot, record.runId), record.branch);
  await markRemoved(db, record.runId);
}

export async function cleanOrphanedCopies(db: Db): Promise<number> {
  let removed = 0;
  for (const record of await orphanedWorktrees(db)) {
    try {
      await removeCopy(db, record);
      removed += 1;
    } catch (error) {
      console.error(`Could not remove the worktree for run ${record.runId}`, error);
    }
  }
  return removed;
}
