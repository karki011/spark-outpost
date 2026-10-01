import { describe, expect, it } from 'vitest';
import {
  areaOf,
  escalatedHighStakes,
  isOneLiner,
  smallReviewDiff,
  wantsCritic,
} from './critic-rule.ts';
import { candidates, plainFacts } from './route-fixtures.ts';
import { routeBuilder, type RouteContext } from './routing.ts';

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

describe('escalated high-stakes results', () => {
  const now = new Date('2026-09-30T12:00:00Z');
  const context: RouteContext = {
    routing: 'auto',
    chat: { provider: 'claude', model: 'sonnet', modelLabel: 'Sonnet 5', effort: 'medium' },
    providerEffort: null,
    candidates,
    now,
  };
  const rated = (value: number) => ({ value, confidence: 0.9 });
  const session = {
    pick: { provider: 'claude', model: 'sonnet', modelLabel: 'Sonnet 5', effort: 'high' },
    contextTokens: 180_000,
    lastUsedAt: now,
  };
  const route = (stakes: number) =>
    routeBuilder(context, {
      ...plainFacts,
      session,
      ratings: {
        complexity: rated(4),
        stakes: rated(stakes),
        ambiguity: rated(2),
        contextDependence: rated(2),
      },
    });

  it('sends an escalated result with stakes 4 or more to the Critic, even a one-liner', () => {
    const typo = [file('src/ledger.ts', 1, 1)];
    expect(escalatedHighStakes(route(4))).toBe(true);
    expect(wantsCritic(typo, false, escalatedHighStakes(route(4)))).toBe(true);
    expect(wantsCritic([], false, true)).toBe(false);
  });

  it('leaves lower-stakes escalations and plain routes to the usual rule', () => {
    expect(escalatedHighStakes(route(2))).toBe(false);
    expect(escalatedHighStakes(routeBuilder(context, plainFacts))).toBe(false);
    expect(escalatedHighStakes(undefined)).toBe(false);
  });
});

describe('a small diff for the first review (live run 4)', () => {
  const file = (path: string, lines: number) => ({ path, additions: lines, deletions: 0 });

  it('counts source and test lines, not lockfiles or docs, and at most three source files', () => {
    const c = [
      file('src/csv-export.ts', 19),
      file('src/rate-limit.ts', 27),
      file('test/csv-export.test.ts', 18),
      file('test/rate-limit.test.ts', 18),
      file('README.md', 2),
    ];
    expect(smallReviewDiff(c)).toBe(true);
    expect(smallReviewDiff([...c, file('pnpm-lock.yaml', 4000)])).toBe(true);
    expect(smallReviewDiff([file('src/a.ts', 151)])).toBe(false);
    expect(
      smallReviewDiff([
        file('src/a.ts', 1),
        file('src/b.ts', 1),
        file('src/c.ts', 1),
        file('src/d.ts', 1),
      ]),
    ).toBe(false);
    expect(smallReviewDiff([])).toBe(false);
  });

  it('keeps high effort for files a top-tier piece owns', () => {
    expect(smallReviewDiff([file('src/a.ts', 5)], new Set(['src/a.ts']))).toBe(false);
  });
});
