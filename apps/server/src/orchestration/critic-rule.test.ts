import { describe, expect, it } from 'vitest';
import { areaOf, isOneLiner, wantsCritic } from './critic-rule.ts';

const file = (path: string, additions = 10, deletions = 0) => ({ path, additions, deletions });

describe('wantsCritic', () => {
  it('skips one-liners, even with an agreed plan', () => {
    const typo = [file('src/spend-summaries.ts', 1, 1)];
    expect(isOneLiner(typo)).toBe(true);
    expect(wantsCritic(typo, false)).toBe(false);
    expect(wantsCritic(typo, true)).toBe(false);
    expect(wantsCritic([], true)).toBe(false);
  });

  it('reviews a build from an agreed plan (s04: CSV export, 3 files)', () => {
    const csv = [
      file('apps/web/src/analytics/spend-csv.ts', 60),
      file('apps/web/src/analytics/SpendTab.tsx', 13),
      file('apps/web/src/analytics/spend-csv.test.ts', 30),
    ];
    expect(wantsCritic(csv, true)).toBe(true);
  });

  it('reviews a story across layers without a plan (s11: DB + API + UI)', () => {
    const tags = [
      file('migrations/004_project_tags.sql', 12),
      file('src/projects.ts', 30, 4),
      file('src/api.ts', 25, 3),
      file('src/ui.ts', 15, 2),
      file('test/tags.test.ts', 40),
    ];
    expect(wantsCritic(tags, false)).toBe(true);
    expect(wantsCritic([file('migrations/004.sql'), file('src/projects.ts')], false)).toBe(true);
  });

  it('skips a small single-area fix with its test (s06, s12)', () => {
    expect(
      wantsCritic([file('src/percent.ts', 3, 2), file('test/percent.test.ts', 12)], false),
    ).toBe(false);
    const endpoint = [
      file('src/projects.ts', 20),
      file('src/api.ts', 12),
      file('test/api.test.ts'),
    ];
    expect(wantsCritic(endpoint, false)).toBe(false);
  });

  it('reviews three source files, two packages, or a large diff; docs and lockfiles do not count', () => {
    expect(wantsCritic([file('src/a.ts'), file('src/b.ts'), file('src/c.ts')], false)).toBe(true);
    expect(
      wantsCritic([file('apps/web/src/a.ts'), file('packages/contracts/src/b.ts')], false),
    ).toBe(true);
    expect(wantsCritic([file('src/a.ts'), file('README.md'), file('pnpm-lock.yaml')], false)).toBe(
      false,
    );
    expect(wantsCritic([file('src/a.ts', 400)], false)).toBe(true);
  });

  it('names the area of a path', () => {
    expect(areaOf('README.md')).toBe('.');
    expect(areaOf('src/a.ts')).toBe('src');
    expect(areaOf('apps/server/src/a.ts')).toBe('apps/server');
    expect(areaOf('packages/x')).toBe('packages');
  });
});
