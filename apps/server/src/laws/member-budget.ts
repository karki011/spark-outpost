import type { BudgetLimit } from '@spark-outpost/contracts';
import {
  LAW_BUDGET_MIN_MS,
  LAW_BUDGET_MIN_TOOL_CALLS,
  LAW_BUDGET_SHARE,
} from '../advisor/policy.ts';
import type { BudgetLimits, BudgetUsage } from '../orchestration/budget.ts';
import type { SignalSource } from '../orchestration/task-signals.ts';

export interface BudgetSize {
  toolCalls: number;
  activeMs: number;
}

export interface MemberBudget extends BudgetSize {
  complexity: number;
  source: SignalSource;
  toolCallsAt: number;
  activeMsAt: number;
  hit: BudgetLimit | null;
  closed: boolean;
}

function level(complexity: number): number {
  return Math.min(5, Math.max(1, Math.round(complexity))) - 1;
}

export function scaledBudget(base: BudgetLimits, complexity: number): BudgetSize {
  const share = LAW_BUDGET_SHARE[level(complexity)]!;
  return {
    toolCalls: Math.min(
      base.toolCallLimit,
      Math.max(Math.ceil(base.toolCallLimit * share), LAW_BUDGET_MIN_TOOL_CALLS),
    ),
    activeMs: Math.min(
      base.activeLimitMs,
      Math.max(Math.round(base.activeLimitMs * share), LAW_BUDGET_MIN_MS),
    ),
  };
}

export function memberBudget(
  base: BudgetLimits,
  complexity: { value: number; source: SignalSource },
  usage: BudgetUsage,
): MemberBudget {
  return {
    ...scaledBudget(base, complexity.value),
    complexity: complexity.value,
    source: complexity.source,
    toolCallsAt: usage.toolCalls,
    activeMsAt: usage.activeMs,
    hit: null,
    closed: false,
  };
}

export function memberBudgetExceeded(
  budget: MemberBudget | null | undefined,
  usage: BudgetUsage,
): BudgetLimit | null {
  if (!budget || budget.closed) return null;
  if (usage.toolCalls - budget.toolCallsAt >= budget.toolCalls) return 'tool_calls';
  if (usage.activeMs - budget.activeMsAt >= budget.activeMs) return 'time';
  return null;
}

export function memberUsed(budget: MemberBudget, limit: BudgetLimit, usage: BudgetUsage) {
  if (limit === 'tool_calls') {
    return { used: usage.toolCalls - budget.toolCallsAt, allowed: budget.toolCalls };
  }
  return { used: usage.activeMs - budget.activeMsAt, allowed: budget.activeMs };
}

function minutes(ms: number): string {
  const value = ms / 60_000;
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function budgetText(budget: BudgetSize): string {
  return `budget ${budget.toolCalls} tool calls · ${minutes(budget.activeMs)} min`;
}

export function budgetWhy(budget: MemberBudget): string {
  const rated = budget.source === 'jev' ? ' (Jev)' : '';
  return `${budgetText(budget)} for complexity ${budget.complexity}${rated}`;
}

export function budgetStopLine(budget: MemberBudget, name: string): string {
  return `${name} used its ${budgetText(budget).replace('budget ', '')} budget for complexity ${budget.complexity} work and was stopped so the change doesn't sprawl. Continue to let it finish, or stop and look at what it has done.`;
}
