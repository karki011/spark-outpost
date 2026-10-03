import { LAW_BUDGET_ENFORCED, POLICY_VERSION } from '../advisor/policy.ts';
import { insertDecision } from '../persistence/orchestrations.ts';
import { budgetUsage } from '../orchestration/budget-check.ts';
import type { MemberRoute } from '../orchestration/routing.ts';
import type { Session } from '../orchestration/session.ts';
import type { Spawn } from '../orchestration/transitions.ts';
import { ensureEstimate, sessionSignals } from './estimate-history.ts';
import { budgetText, budgetWhy, memberBudget, type MemberBudget } from './member-budget.ts';

async function recordBudget(s: Session, budget: MemberBudget, childRunId: string): Promise<void> {
  await insertDecision(s.deps.db, {
    runId: s.lease.runId,
    purpose: 'law',
    childRunId,
    role: 'builder',
    stepIndex: 0,
    jevStatus: 'not_asked',
    inputTokens: null,
    costUsd: null,
    policyVersion: POLICY_VERSION,
    body: {
      summary: budgetWhy(budget),
      applied: 'rules',
      gate: null,
      jevError: null,
      latencyMs: null,
      answer: {
        law: 'budget',
        complexity: budget.complexity,
        source: budget.source,
        toolCalls: budget.toolCalls,
        activeMs: budget.activeMs,
      },
    },
  });
}

export async function startBuilderLaws(
  s: Session,
  spawn: Spawn,
  route: MemberRoute,
  childRunId: string,
): Promise<void> {
  if (spawn.role === 'critic' && s.memberBudget) s.memberBudget.closed = true;
  if (s.flow.solo || spawn.role !== 'builder' || spawn.reason !== 'first') return;
  if (s.memberBudget) return;
  await ensureEstimate(s);
  if (!LAW_BUDGET_ENFORCED) return;
  const complexity = route.score?.signals.complexity ?? sessionSignals(s).complexity;
  s.memberBudget = memberBudget(s.baseLimits, complexity, await budgetUsage(s));
  await recordBudget(s, s.memberBudget, childRunId);
}

export function openBudget(s: Pick<Session, 'memberBudget'>): MemberBudget | null {
  const budget = s.memberBudget;
  return budget && !budget.closed ? budget : null;
}

export function crewBudget(s: Pick<Session, 'memberBudget'>, role: string): string | null {
  const budget = role === 'builder' ? openBudget(s) : null;
  return budget ? budgetText(budget) : null;
}
