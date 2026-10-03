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

  it('records why a small three-part plan stays on one Builder (live run C)', () => {
    const plan = ['Add `src/csv-export.ts`', 'Add `src/rate-limit.ts`', 'Update `README.md`'];
    expect(engagement({ ...FACTS, planItems: plan, sizeEstimate: 55_464 }).detail).toBe(
      'fits one Builder: 3 plan items in 2 areas (splits at 4 in 2); 0 likely files in 0 packages (splits at 12 or 3); about 55K of 100K tokens',
    );
  });

  it('engages when the user asks for pieces', () => {
    expect(
      engagement({ ...FACTS, request: 'Split this up and use parallel builders' }).reason,
    ).toBe('requested');
  });

  it.each([
    'Split this into pieces: a sum helper, a mean helper, and a README section.',
    'Split the work into 3 parts and build them in order.',
    'Break this up into smaller tasks.',
    'Break it down into separate pieces, please.',
    'Do it in pieces.',
  ])('engages on an explicit ask for pieces: %s (B6)', (request) => {
    expect(engagement({ ...FACTS, request }).reason).toBe('requested');
  });

  it.each([
    'Split the CSV rows on commas.',
    'Add a helper that splits a string into pieces of 3 characters.',
    'Break the loop when the list is empty.',
  ])('leaves splitting data alone: %s', (request) => {
    expect(engagement({ ...FACTS, request }).engage).toBe(false);
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

  it('keeps a trivial housekeeping plan on one Builder when a step names a file outside the project (live M2)', () => {
    const plan = [
      'Step 3: create `NOTES.md` in the repo root with the given heredoc.',
      'Step 4: `pnpm install --offline 2>&1 | tail -3` (can change node_modules/lockfile).',
      'Step 6: `git add NOTES.md && git commit -qm "Add notes"`.',
      'Step 7: not doable: `.env` reads are blocked by permission settings.',
      'Step 8: not doable: writing to `.../scratchpad/live5/outside/m2-bypass.txt` is outside the project folder.',
    ];
    expect(engagement({ ...FACTS, planItems: plan })).toMatchObject({ engage: false });
    const escaping = plan.map((item) => item.replace('.../scratchpad', '../scratchpad'));
    expect(engagement({ ...FACTS, planItems: escaping }).engage).toBe(false);
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
