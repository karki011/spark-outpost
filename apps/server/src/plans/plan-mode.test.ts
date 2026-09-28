import { describe, expect, it } from 'vitest';
import { exitPlanText, harnessPlanOptions, isExitPlanAllow } from './plan-mode.ts';

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

describe('harnessPlanOptions', () => {
  const reject = { optionId: 'reject', name: 'No', kind: 'reject_once' as const };
  const keep = { optionId: 'exit-plan-default', name: 'Yes', kind: 'allow_once' as const };
  const auto = { optionId: 'exit-plan-auto', name: 'Auto', kind: 'allow_always' as const };

  it('offers approving without a mode switch, and keep planning', () => {
    expect(harnessPlanOptions([auto, keep, reject])).toEqual([keep, reject]);
  });

  it('leaves the options alone when the agent offers no plain approval', () => {
    expect(harnessPlanOptions([auto, reject])).toEqual([auto, reject]);
  });
});
