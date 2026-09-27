import type { BudgetLimit } from '@spark-outpost/contracts';
import { spentUsd, waitedMs } from '../persistence/orchestrations.ts';
import { activeTime, exceededLimit, type BudgetUsage } from './budget.ts';
import { save, type Session } from './session.ts';

function liveUsd(s: Session): number {
  let total = 0;
  for (const usd of s.liveCost.values()) total += usd;
  return total;
}

export async function budgetUsage(s: Session): Promise<BudgetUsage> {
  const waited = await waitedMs(s.deps.db, s.lease.runId);
  return {
    activeMs: activeTime(Date.now() - s.startedAt, waited),
    toolCalls: s.toolCalls,
    costUsd: (await spentUsd(s.deps.db, s.lease.runId)) + liveUsd(s),
  };
}

export async function checkBudget(s: Session): Promise<BudgetLimit | null> {
  if (s.budgetHit) return s.budgetHit;
  const usage = await budgetUsage(s);
  await save(s, { activeMs: usage.activeMs });
  const limit = exceededLimit(usage, s.limits);
  if (!limit) return null;
  s.budgetHit = limit;
  await save(s, { exceeded: limit });
  for (const abort of s.members.values()) abort();
  return limit;
}
