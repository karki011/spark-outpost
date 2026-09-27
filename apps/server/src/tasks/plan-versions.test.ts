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

  it('keeps the version when only statuses change', () => {
    const latest = { version: 1, entries: plan('A', 'B') };
    const started = [{ ...latest.entries[0]!, status: 'in_progress' as const }, latest.entries[1]!];
    expect(nextPlanWrite(latest, started, 'builder-run')).toEqual({
      version: 1,
      overwrite: true,
      supersedesPrevious: false,
    });
  });

  it("folds every plan update from one run into that run's version", () => {
    const latest = { version: 1, entries: plan('Read the code'), sourceRunId: 'architect-run' };
    expect(nextPlanWrite(latest, plan('Edit a.ts', 'Edit b.ts'), 'architect-run')).toEqual({
      version: 1,
      overwrite: true,
      supersedesPrevious: false,
    });
    expect(nextPlanWrite(latest, plan('Edit a.ts', 'Edit b.ts'), 'next-architect')).toEqual({
      version: 2,
      overwrite: false,
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
