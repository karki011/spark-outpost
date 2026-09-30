import { commitWorkingTree, headCommit } from '../projects/snapshot.ts';
import { applyTree, tryMerge } from '../projects/worktrees.ts';

export interface MainMerge {
  merged: boolean;
  conflicts: string[];
  main: string | null;
}

export async function mergeMainInto(
  copy: string,
  main: string,
  base: string | null = null,
): Promise<MainMerge> {
  const from = base ?? (await headCommit(copy));
  if (!from) return { merged: false, conflicts: [], main: null };
  const mainNow = await commitWorkingTree(main, [from], 'Spark Outpost: main for a copy');
  const attempt = await tryMerge(copy, from, mainNow);
  if (attempt.conflicts.length > 0) {
    return { merged: false, conflicts: attempt.conflicts, main: mainNow };
  }
  await applyTree(copy, attempt.current, attempt.tree);
  return { merged: true, conflicts: [], main: mainNow };
}
