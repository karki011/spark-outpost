import type { PlanDocument } from '@spark-outpost/contracts';
import { namedFiles } from '../orchestration/context.ts';
import { git } from '../projects/snapshot.ts';
import { agreedPlanBlock } from './agreed-block.ts';
import type { Queryable } from '../persistence/db.ts';
import { latestApprovedPlan } from '../persistence/plan-documents.ts';

function sameFile(named: string, changed: string): boolean {
  return named === changed || changed.endsWith(`/${named}`) || named.endsWith(`/${changed}`);
}

export function staleAmong(named: readonly string[], changed: readonly string[]): string[] {
  return named.filter((file) => changed.some((path) => sameFile(file, path)));
}

export async function changedSince(root: string, commit: string): Promise<string[]> {
  const output = await git(root, ['diff', '--name-only', '--no-renames', '--relative', commit]);
  return output.split('\n').filter(Boolean);
}

export async function staleFiles(root: string | null, plan: PlanDocument): Promise<string[]> {
  if (!root || !plan.approvedCommit) return [];
  const named = namedFiles([plan.body]);
  if (named.length === 0) return [];
  const changed = await changedSince(root, plan.approvedCommit).catch(() => []);
  return staleAmong(named, changed);
}

export async function agreedPlanFor(
  db: Queryable,
  conversationId: string,
  root: string | null,
): Promise<string | null> {
  const plan = await latestApprovedPlan(db, conversationId);
  if (!plan) return null;
  return agreedPlanBlock(plan, await staleFiles(root, plan));
}
