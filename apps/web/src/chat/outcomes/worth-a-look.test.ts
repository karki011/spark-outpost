import { describe, expect, it } from 'vitest';
import { outsidePlanLabel, worthALook } from './worth-a-look.ts';

const CLAIM = "Bolt said the checks pass, but Spark's own run failed: `pnpm run test` exited 1.";
const stored = (file: string) =>
  `Changed \`${file}\`, which the request and plan didn't name — check it.`;

describe('worthALook', () => {
  it('shows an item once however often it was stored', () => {
    const view = worthALook({ laws: [CLAIM, CLAIM, `${CLAIM}  `], outsidePlan: [] });
    expect(view).toEqual({ items: [CLAIM], outsidePlan: [] });
  });

  it('folds stored per-file lines into the files outside the plan', () => {
    const view = worthALook({
      laws: [CLAIM, stored('a.ts'), stored('b.ts'), stored('a.ts')],
      outsidePlan: ['c.ts', 'b.ts'],
    });
    expect(view).toEqual({ items: [CLAIM], outsidePlan: ['c.ts', 'b.ts', 'a.ts'] });
  });

  it('is empty when nothing was flagged', () => {
    expect(worthALook({ laws: [], outsidePlan: [] })).toEqual({ items: [], outsidePlan: [] });
  });

  it('counts the files in the collapsed line', () => {
    expect(outsidePlanLabel(1)).toBe('1 file outside the plan');
    expect(outsidePlanLabel(5)).toBe('5 files outside the plan');
  });
});
