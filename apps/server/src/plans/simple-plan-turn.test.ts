import { describe, expect, it } from 'vitest';
import type { RunInput } from '../workflow/run-input.ts';
import { isExitPlanAllow, plansThisTurn } from './plan-mode.ts';
import { asPlanTurn, isPlanCommand, isPlanModeChat, planCommandText } from './simple-plan-turn.ts';

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

describe('what starts a plan turn', () => {
  it('is a /plan message in a project, whatever the mode', () => {
    expect(isPlanCommand(input())).toBe(true);
    expect(isPlanCommand(input({ userRequest: 'Add CSV export' }))).toBe(false);
    expect(isPlanCommand(input({ projectRoots: [] }))).toBe(false);
    expect(isPlanCommand(input({ parentRunId: 'parent' }))).toBe(false);
  });

  it('knows a chat the user put in Plan mode', () => {
    const planChat = input({ userRequest: 'Add CSV export', agentMode: 'plan', mode: 'ask' });
    expect(isPlanModeChat(planChat)).toBe(true);
    expect(isPlanModeChat(input({ userRequest: 'Add CSV export' }))).toBe(false);
    expect(isPlanModeChat({ ...planChat, projectRoots: [] })).toBe(false);
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

  it('is a read-only turn with the message as typed when the agent has no plan mode of its own', () => {
    const codex = input({
      provider: 'codex',
      agentMode: 'agent-full-access',
      settings: {
        method: 'cli',
        model: 'gpt-6-sol',
        modelLabel: null,
        effort: null,
        mode: 'agent-full-access',
      },
    });
    const turn = asPlanTurn(codex);
    expect(turn).toMatchObject({
      prompt: '/plan Add CSV export',
      userRequest: '/plan Add CSV export',
      mode: 'ask',
      planning: true,
    });
    expect(turn.plansFirst).toBeUndefined();
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

  it("is never set from the wording: only the user's mode counts", () => {
    expect(plansThisTurn(codexAsk)).toBe(false);
    expect(plansThisTurn({ ...codexAsk, provider: 'claude' })).toBe(true);
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
