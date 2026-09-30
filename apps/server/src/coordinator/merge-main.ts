import { commitWorkingTree, headCommit } from '../projects/snapshot.ts';
import { applyTree, tryMerge } from '../projects/worktrees.ts';

export interface MainMerge {
  merged: boolean;
  conflicts: string[];
}

export async function mergeMainInto(copy: string, main: string): Promise<MainMerge> {
  const [copyHead, mainHead] = await Promise.all([headCommit(copy), headCommit(main)]);
  if (!copyHead || !mainHead) return { merged: false, conflicts: [] };
  const mainNow = await commitWorkingTree(main, [mainHead], 'Spark Outpost: main for a copy');
  const attempt = await tryMerge(copy, copyHead, mainNow);
  if (attempt.conflicts.length > 0) return { merged: false, conflicts: attempt.conflicts };
  await applyTree(copy, attempt.current, attempt.tree);
  return { merged: true, conflicts: [] };
}
