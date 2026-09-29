import { describe, expect, it } from 'vitest';
import { engagement, type EngageFacts } from './engage.ts';

const FACTS: EngageFacts = {
  request: 'Add a budget bar to the project page',
  planItems: [],
  likely: [],
  sizeEstimate: 30_000,
  budgetTokens: 100_000,
};

const file = (path: string, pkg: string) => ({ path, package: pkg });

describe('engagement', () => {
  it('stays on one Builder when nothing points at a split', () => {
    expect(engagement(FACTS)).toMatchObject({ engage: false, reason: null, tooBigUnsure: false });
  });

  it('engages when the user asks for pieces', () => {
    expect(
      engagement({ ...FACTS, request: 'Split this up and use parallel builders' }).reason,
    ).toBe('requested');
  });

  it('engages for an agreed plan with 4 items in 2 areas, not in 1 area', () => {
    const twoAreas = [
      'Store it in `apps/server/src/a.ts`',
      'Serve it from `apps/server/src/b.ts`',
      'Show it in `apps/web/src/c.tsx`',
      'Export it in `apps/web/src/d.ts`',
    ];
    expect(engagement({ ...FACTS, planItems: twoAreas }).reason).toBe('plan');
    const oneArea = twoAreas.map((item) => item.replace('apps/web', 'apps/server'));
    expect(engagement({ ...FACTS, planItems: oneArea }).engage).toBe(false);
  });

  it('engages when the scan spreads over 12 files or 3 packages', () => {
    const many = Array.from({ length: 12 }, (_, index) => file(`src/f${index}.ts`, '.'));
    expect(engagement({ ...FACTS, likely: many }).reason).toBe('scan');
    const spread = ['apps/web', 'apps/server', 'packages/contracts'].map((pkg) =>
      file(`${pkg}/x.ts`, pkg),
    );
    expect(engagement({ ...FACTS, likely: spread }).reason).toBe('scan');
  });

  it('engages when the size estimate is over the Builder budget and flags the unsure band', () => {
    expect(engagement({ ...FACTS, sizeEstimate: 130_000 })).toMatchObject({
      reason: 'size',
      tooBigUnsure: false,
    });
    expect(engagement({ ...FACTS, sizeEstimate: 110_000 })).toMatchObject({
      reason: 'size',
      tooBigUnsure: true,
    });
    expect(engagement({ ...FACTS, sizeEstimate: 90_000 })).toMatchObject({
      engage: false,
      tooBigUnsure: true,
    });
  });
});
