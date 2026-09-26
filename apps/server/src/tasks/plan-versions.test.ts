import { describe, expect, it } from 'vitest';
import type { PlanEntry } from '@spark-outpost/contracts';
import { nextPlanWrite } from './plan-versions.ts';

const plan = (...contents: string[]): PlanEntry[] =>
  contents.map((content) => ({ content, priority: 'medium', status: 'pending' }));

describe('nextPlanWrite', () => {
  it('starts at version 1 and skips an empty first plan', () => {
    expect(nextPlanWrite(null, plan('A'))).toEqual({
      version: 1,
      overwrite: false,
      supersedesPrevious: false,
    });
    expect(nextPlanWrite(null, [])).toBeNull();
  });

  it('drops an update identical to the latest version', () => {
    expect(nextPlanWrite({ version: 3, entries: plan('A', 'B') }, plan('A', 'B'))).toBeNull();
  });

  it('adds the next version and supersedes the previous one only when replaced', () => {
    const latest = { version: 2, entries: plan('A', 'B', 'C') };
    expect(nextPlanWrite(latest, plan('A', 'B', 'D'))).toEqual({
      version: 3,
      overwrite: false,
      supersedesPrevious: false,
    });
    expect(nextPlanWrite(latest, plan('X', 'Y'))).toMatchObject({
      version: 3,
      supersedesPrevious: true,
    });
  });

  it('overwrites the latest version once the cap is reached', () => {
    expect(nextPlanWrite({ version: 200, entries: plan('A') }, plan('B'))).toEqual({
      version: 200,
      overwrite: true,
      supersedesPrevious: false,
    });
  });
});
