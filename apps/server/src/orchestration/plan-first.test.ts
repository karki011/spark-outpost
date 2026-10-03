import { describe, expect, it } from 'vitest';
import { CHECKPOINT_OPTION } from '@spark-outpost/contracts';
import {
  FULL_AUTO_PLAN_SECONDS,
  planFirstCard,
  planFirstPrompt,
  planPrNote,
  specPlanLine,
} from './plan-first.ts';
import { specByRule } from './builder-complexity.ts';

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

  it('counts down at Automatic like other cards', () => {
    const automatic = planFirstCard(1, 'hands-off', 10);
    expect(automatic.payload.autoOption).toBe(CHECKPOINT_OPTION.makeChange);
    expect(automatic.payload.reason).toContain('Automatic builds it in 10 s');
    expect(planFirstCard(1, 'hands-off', null).payload.reason).toContain('Auto-continue is off');
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
  it('is the plan when every listed part names files or code', () => {
    expect(specByRule(SPEC)).toBe('3 of 3 listed parts name files or code');
    expect(specByRule('- add a\n- add b\n- add c')).toBeNull();
  });

  it('counts a short list when every part names files or code (live run D)', () => {
    const d = [
      'Split this up into pieces, they are independent:',
      '- Add a migration `migrations/002_upload_tags.sql` that creates an `upload_tags` table (`upload_key` TEXT referencing `uploads(key)` ON DELETE CASCADE, `tag` TEXT NOT NULL, primary key on both columns) and an index on `tag`.',
      '- Add `src/slug.ts` exporting `slugify(text: string): string` (lower case, ASCII letters and digits, runs of anything else become one dash, no leading or trailing dash). Add tests in `test/slug.test.ts`.',
    ].join('\n');
    expect(specByRule(d)).toBe('2 of 2 listed parts name files or code');
  });

  it('says why there was no plan turn', () => {
    expect(specPlanLine('3 of 3 listed parts name files or code', 2)).toBe(
      'Your request is already a plan (3 of 3 listed parts name files or code): saved as plan v2, no separate plan turn',
    );
    expect(specPlanLine('x', null)).toContain('building it as written');
  });
});
