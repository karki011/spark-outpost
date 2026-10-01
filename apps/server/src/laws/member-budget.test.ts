import { describe, expect, it } from 'vitest';
import {
  budgetText,
  budgetWhy,
  memberBudget,
  memberBudgetExceeded,
  scaledBudget,
} from './member-budget.ts';

const base = { activeLimitMs: 15 * 60_000, toolCallLimit: 60, costCapUsd: 5 };
const usage = (toolCalls: number, activeMs: number) => ({ toolCalls, activeMs, costUsd: 0 });

describe('Parkinson budgets', () => {
  it('scales the Builder budget with complexity and never past the run budget', () => {
    expect(scaledBudget(base, 1)).toEqual({ toolCalls: 18, activeMs: 270_000 });
    expect(scaledBudget(base, 2)).toEqual({ toolCalls: 30, activeMs: 450_000 });
    expect(scaledBudget(base, 4)).toEqual({ toolCalls: 60, activeMs: 900_000 });
    expect(scaledBudget({ ...base, toolCallLimit: 6 }, 1).toolCalls).toBe(6);
    expect(scaledBudget({ ...base, toolCallLimit: 20 }, 1).toolCalls).toBe(10);
  });

  it('counts from where the Builder started and stops at the first limit', () => {
    const budget = memberBudget(base, { value: 1, source: 'jev' }, usage(5, 60_000));
    expect(memberBudgetExceeded(budget, usage(22, 100_000))).toBeNull();
    expect(memberBudgetExceeded(budget, usage(23, 100_000))).toBe('tool_calls');
    expect(memberBudgetExceeded(budget, usage(10, 330_000))).toBe('time');
    expect(memberBudgetExceeded({ ...budget, closed: true }, usage(99, 999_999))).toBeNull();
  });

  it('writes the budget for the agent head and the why line', () => {
    const budget = memberBudget(base, { value: 1, source: 'jev' }, usage(0, 0));
    expect(budgetText(budget)).toBe('budget 18 tool calls · 4.5 min');
    expect(budgetWhy(budget)).toBe('budget 18 tool calls · 4.5 min for complexity 1 (Jev)');
  });
});
