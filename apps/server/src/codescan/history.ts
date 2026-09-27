import type { Commit } from './git.ts';

export function churnByFile(commits: readonly Commit[]): Map<string, number> {
  const churn = new Map<string, number>();
  for (const commit of commits) {
    for (const file of commit.files) churn.set(file, (churn.get(file) ?? 0) + 1);
  }
  return churn;
}

export function coChanged(
  commits: readonly Commit[],
  seeds: ReadonlySet<string>,
): Map<string, number> {
  const together = new Map<string, number>();
  for (const commit of commits) {
    if (!commit.files.some((file) => seeds.has(file))) continue;
    for (const file of commit.files) {
      if (!seeds.has(file)) together.set(file, (together.get(file) ?? 0) + 1);
    }
  }
  return together;
}
