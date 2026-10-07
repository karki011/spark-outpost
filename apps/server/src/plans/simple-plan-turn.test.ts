import { describe, expect, it } from 'vitest';
import type { RunInput } from '../workflow/run-input.ts';
import { isExitPlanAllow, plansThisTurn } from './plan-mode.ts';
import { asPlanTurn, isPlanTurn, planCommandText } from './simple-plan-turn.ts';

const input = (extra: Partial<RunInput> = {}): RunInput =>
  ({
    prompt: '/plan Add CSV export',
    userRequest: '/plan Add CSV export',
    provider: 'claude',
    mode: 'do',
    agentMode: 'auto',
    parentRunId: null,
    projectRoots: ['/repo'],
    settings: { method: 'cli', model: 'sonnet', modelLabel: null, effort: null, mode: 'auto' },
    ...extra,
  }) as RunInput;

describe('planCommandText', () => {
  it('reads /plan and nothing that only looks like it', () => {
    expect(planCommandText('/plan Add CSV export')).toBe('Add CSV export');
    expect(planCommandText('  /PLAN\nAdd CSV export')).toBe('Add CSV export');
    expect(planCommandText('/plan')).toBe('');
    expect(planCommandText('/planner Add CSV export')).toBeNull();
    expect(planCommandText('Please /plan this')).toBeNull();
  });
});

describe('isPlanTurn', () => {
  it('is a /plan message or a chat the user put in Plan mode, in a project', () => {
    expect(isPlanTurn(input())).toBe(true);
    expect(
      isPlanTurn(input({ userRequest: 'Add CSV export', agentMode: 'plan', mode: 'ask' })),
    ).toBe(true);
    expect(isPlanTurn(input({ userRequest: 'Add CSV export' }))).toBe(false);
    expect(isPlanTurn(input({ projectRoots: [] }))).toBe(false);
    expect(isPlanTurn(input({ parentRunId: 'parent' }))).toBe(false);
  });
});

describe('asPlanTurn', () => {
  it('becomes a changing run that plans first, without the command, in the mode the user picked', () => {
    expect(asPlanTurn(input())).toMatchObject({
      prompt: 'Add CSV export',
      userRequest: 'Add CSV export',
      mode: 'do',
      plansFirst: true,
      planning: false,
      settings: { mode: 'auto' },
    });
  });

  it('leaves the mode after the plan to the agent when the chat itself is in Plan mode', () => {
    const planChat = input({
      prompt: 'Add CSV export',
      userRequest: 'Add CSV export',
      mode: 'ask',
      agentMode: 'plan',
      settings: { method: 'cli', model: 'sonnet', modelLabel: null, effort: null, mode: 'plan' },
    });
    expect(asPlanTurn(planChat)).toMatchObject({
      prompt: 'Add CSV export',
      settings: { mode: null },
    });
  });

  it('keeps a bare /plan as the message', () => {
    expect(asPlanTurn(input({ prompt: '/plan', userRequest: '/plan' })).userRequest).toBe('/plan');
  });
});

describe('plan mode chosen by wording', () => {
  const codexAsk = {
    provider: 'codex',
    mode: 'ask' as const,
    userRequest: "Plan only: don't change files yet",
  };

  it("is never set from the wording when only the user's mode counts", () => {
    expect(plansThisTurn(codexAsk)).toBe(true);
    expect(plansThisTurn(codexAsk, true)).toBe(false);
    expect(plansThisTurn({ ...codexAsk, provider: 'claude' }, true)).toBe(true);
  });
});

describe('isExitPlanAllow', () => {
  it("knows both agents' ways of saying build the plan", () => {
    expect(isExitPlanAllow('exit-plan-default')).toBe(true);
    expect(isExitPlanAllow('implement_plan')).toBe(true);
    expect(isExitPlanAllow('revise_plan')).toBe(false);
    expect(isExitPlanAllow('reject')).toBe(false);
  });
});
