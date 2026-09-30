import { describe, expect, it } from 'vitest';
import { CHECKPOINT_OPTION } from '@spark-outpost/contracts';
import {
  FULL_AUTO_PLAN_SECONDS,
  planFirstCard,
  planFirstPrompt,
  planPrNote,
  requestIsThePlan,
  specPlanLine,
} from './plan-first.ts';

const SPEC = '- `src/a.ts` with `a()`\n- `src/b.ts` with `b()`\n- tests in `test/a.test.ts`';

describe('the plan-first card', () => {
  it('builds by itself at Full auto when the countdown runs out', () => {
    const card = planFirstCard(3, 'full-auto', 10);
    expect(card.title).toBe('Build this plan?');
    expect(card.payload.autoOption).toBe(CHECKPOINT_OPTION.makeChange);
    expect(card.options.map((option) => [option.optionId, option.name])).toEqual([
      [CHECKPOINT_OPTION.makeChange, 'Build this plan'],
      [CHECKPOINT_OPTION.editPlan, 'Edit plan'],
      [CHECKPOINT_OPTION.stop, 'Stop'],
    ]);
    expect(card.payload.reason).toContain('plan v3');
    expect(card.payload.reason).toContain('builds it in 10 s');
  });

  it('says so when auto-continue is off and Full auto uses its own wait', () => {
    const card = planFirstCard(1, 'full-auto', null);
    expect(card.payload.reason).toContain(
      `Auto-continue is off, so Full auto waits ${FULL_AUTO_PLAN_SECONDS} s`,
    );
  });

  it('waits for the user at Review each step and Automatic', () => {
    for (const level of ['balanced', 'hands-off'] as const) {
      expect(planFirstCard(1, level, 10).payload.autoOption).toBeNull();
    }
  });

  it('asks for a plan without changes, with the requested revision', () => {
    expect(planFirstPrompt('Add export', null)).toContain('Do not change any files yet');
    expect(planFirstPrompt('Add export', 'skip docs')).toContain('skip docs');
  });

  it('puts the plan in the PR body, capped', () => {
    expect(planPrNote('1. Add export')).toBe('Plan it followed:\n\n1. Add export');
    expect(planPrNote('x'.repeat(10_000)).length).toBeLessThan(4_100);
  });
});

describe('a request that is already a spec', () => {
  it('is the plan at Automatic and Full auto, not at Review each step', () => {
    expect(requestIsThePlan('hands-off', SPEC)).toBe('3 of 3 listed parts name files or code');
    expect(requestIsThePlan('full-auto', SPEC)).not.toBeNull();
    expect(requestIsThePlan('balanced', SPEC)).toBeNull();
    expect(requestIsThePlan('hands-off', '- add a\n- add b\n- add c')).toBeNull();
  });

  it('says why there was no plan turn', () => {
    expect(specPlanLine('3 of 3 listed parts name files or code', 2)).toBe(
      'Your request is already a plan (3 of 3 listed parts name files or code): saved as plan v2, no separate plan turn',
    );
    expect(specPlanLine('x', null)).toContain('building it as written');
  });
});
