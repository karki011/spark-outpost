import { describe, expect, it } from 'vitest';
import { exitPlanText, isExitPlanAllow, planFileText, plansThisTurn } from './plan-mode.ts';

describe('isExitPlanAllow', () => {
  it('counts every exit-plan choice as approval, including the clear-context ones', () => {
    for (const id of [
      'exit-plan-default',
      'exit-plan-auto',
      'exit-plan-bypass',
      'exit-plan-accept-edits',
      'exit-plan-clear-auto',
      'exit-plan-clear-bypass',
      'exit-plan-clear-accept-edits',
    ]) {
      expect(isExitPlanAllow(id)).toBe(true);
    }
  });

  it('does not count a rejection or another tool', () => {
    expect(isExitPlanAllow('reject')).toBe(false);
    expect(isExitPlanAllow('allow-once')).toBe(false);
    expect(isExitPlanAllow(null)).toBe(false);
  });
});

describe('exitPlanText', () => {
  const content = [{ type: 'content', content: { type: 'text', text: 'From content' } }];

  it('prefers the plan the tool was called with', () => {
    expect(exitPlanText('switch_mode', { plan: ' From input ' }, content)).toBe('From input');
  });

  it('falls back to the text shown in the tool call', () => {
    expect(exitPlanText('switch_mode', {}, content)).toBe('From content');
  });

  it('ignores other tools and empty plans', () => {
    expect(exitPlanText('edit', { plan: 'x' }, content)).toBeNull();
    expect(exitPlanText('switch_mode', { plan: '  ' }, [])).toBeNull();
  });
});

describe('which turns plan in the native plan mode (B5)', () => {
  const ask = { mode: 'ask' as const, userRequest: 'What does divide return for 0?' };

  it('plans every Ask turn of a Claude chat in Plan mode, and Codex Ask turns that ask for a plan', () => {
    expect(plansThisTurn({ ...ask, provider: 'claude' })).toBe(true);
    expect(plansThisTurn({ ...ask, provider: 'codex' })).toBe(false);
    expect(
      plansThisTurn({
        ...ask,
        provider: 'codex',
        userRequest: 'Make a short plan for input checks. Plan only.',
      }),
    ).toBe(true);
  });

  it('never plans a Do turn by itself, and follows the harness when it says', () => {
    expect(plansThisTurn({ provider: 'claude', mode: 'do', userRequest: 'Plan only.' })).toBe(
      false,
    );
    expect(plansThisTurn({ ...ask, provider: 'claude', planning: false })).toBe(false);
    expect(plansThisTurn({ ...ask, provider: 'codex', planning: true })).toBe(true);
  });
});

describe('planFileText', () => {
  it('reads a plan Claude writes to its plans folder and nothing else', () => {
    const plan = { file_path: '/Users/a/.claude/plans/csv.md', content: ' 1. Add CSV \n' };
    expect(planFileText(plan)).toBe('1. Add CSV');
    expect(planFileText({ ...plan, file_path: '/repo/.spark/plans/csv.md' })).toBe('1. Add CSV');
    expect(planFileText({ ...plan, file_path: '/repo/src/csv.md' })).toBeNull();
    expect(planFileText({ ...plan, content: '  ' })).toBeNull();
    expect(planFileText(null)).toBeNull();
  });
});
