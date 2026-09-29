import type { BudgetLimit } from '@spark-outpost/contracts';
import { spentUsd, waitedMs } from '../persistence/orchestrations.ts';
import { activeTime, exceededLimit, type BudgetUsage } from './budget.ts';
import { fixRoundLimits, save, type Session } from './session.ts';

function liveUsd(s: Session): number {
  let total = 0;
  for (const usd of s.liveCost.values()) total += usd;
  return total;
}

export async function budgetUsage(s: Session): Promise<BudgetUsage> {
  const waited = await waitedMs(s.deps.db, s.lease.runId);
  s.settledUsd = await spentUsd(s.deps.db, s.lease.runId);
  return {
    activeMs: activeTime(Date.now() - s.startedAt, waited),
    toolCalls: s.toolCalls,
    costUsd: s.settledUsd + liveUsd(s),
  };
}

export function fixRoundExceeded(s: Session, usage: BudgetUsage): BudgetLimit | null {
  const round = s.fixRound;
  if (!round) return null;
  const limits = fixRoundLimits(s);
  if (usage.toolCalls - round.toolCallsAt >= limits.toolCalls) return 'tool_calls';
  if (usage.activeMs - round.activeMsAt >= limits.activeMs) return 'time';
  return null;
}

export async function fixRoundShort(s: Session): Promise<BudgetLimit | null> {
  const usage = await budgetUsage(s);
  const limits = fixRoundLimits(s);
  if (s.limits.toolCallLimit - usage.toolCalls < limits.toolCalls) return 'tool_calls';
  if (s.limits.activeLimitMs - usage.activeMs < limits.activeMs) return 'time';
  return null;
}

function stopMembers(s: Session): void {
  for (const abort of s.members.values()) abort();
}

export function meterSpend(s: Session): void {
  const cap = s.limits.costCapUsd;
  if (!s.budgetHit && cap !== null && (s.settledUsd ?? 0) + liveUsd(s) >= cap) {
    s.budgetHit = 'cost';
    stopMembers(s);
    void save(s, { exceeded: 'cost' }).catch(() => undefined);
    return;
  }
  void checkBudget(s).catch(() => undefined);
}

export function checkBudget(s: Session): Promise<BudgetLimit | null> {
  const checks = (s.budgetChecks ??= { running: null, queued: null });
  if (!checks.running) {
    checks.running = measureBudget(s).finally(() => {
      checks.running = null;
    });
    return checks.running;
  }
  checks.queued ??= checks.running
    .then(
      () => undefined,
      () => undefined,
    )
    .then(() => {
      checks.queued = null;
      return checkBudget(s);
    });
  return checks.queued;
}

async function measureBudget(s: Session): Promise<BudgetLimit | null> {
  if (s.budgetHit) return s.budgetHit;
  const usage = await budgetUsage(s);
  await save(s, { activeMs: usage.activeMs });
  const limit = exceededLimit(usage, s.limits);
  const roundLimit = limit ? null : fixRoundExceeded(s, usage);
  if (!limit && !roundLimit) return null;
  if (roundLimit && s.fixRound) {
    s.fixRound.hit = roundLimit;
    s.budgetHit = roundLimit;
  } else if (limit) {
    s.budgetHit = limit;
    await save(s, { exceeded: limit });
  }
  stopMembers(s);
  return s.budgetHit;
}
