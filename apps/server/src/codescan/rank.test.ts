import { describe, expect, it } from 'vitest';
import {
  nameWeight,
  personalisedPageRank,
  rankFiles,
  type NodeFacts,
  type RankInput,
} from './rank.ts';
import type { TextMatch } from './ripgrep.ts';

function facts(defIds: number[], refIds: number[], pkg = 'app'): NodeFacts {
  return { defIds, refIds, lines: 10, package: pkg, hasTest: false };
}

function match(count: number, ...terms: string[]): TextMatch {
  return { count, terms: new Set(terms) };
}

function input(overrides: Partial<RankInput>): RankInput {
  return {
    facts: new Map(),
    matches: new Map(),
    pathHits: new Set(),
    namedDefiners: new Map(),
    namedIds: new Set(),
    uncommitted: new Set(),
    coChange: new Map(),
    churn: new Map(),
    packageOf: () => '.',
    ...overrides,
  };
}

describe('personalisedPageRank', () => {
  it('keeps the total rank at one and flows rank along references', () => {
    const rank = personalisedPageRank([[{ to: 1, weight: 1 }], [], []], [1, 0, 0]);
    expect(rank.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 6);
    expect(rank[1]).toBeGreaterThan(rank[2] ?? 0);
  });

  it('spreads rank evenly when nothing is personalised', () => {
    const rank = personalisedPageRank([[], []], [0, 0]);
    expect(rank[0]).toBeCloseTo(0.5, 6);
  });
});

describe('nameWeight', () => {
  it('favours named symbols and discounts common or widely defined names', () => {
    expect(nameWeight(true, 1, 100)).toBe(10);
    expect(nameWeight(false, 1, 1)).toBe(1);
    expect(nameWeight(false, 1, 16)).toBe(0.25);
    expect(nameWeight(false, 6, 1)).toBeCloseTo(0.1);
  });
});

describe('rankFiles', () => {
  it('puts a named path and the definer of a named symbol ahead of plain matches', () => {
    const ranked = rankFiles(
      input({
        facts: new Map([
          ['src/chart/use-chart-data.ts', facts([7], [])],
          ['src/chart/chart.tsx', facts([8], [7])],
          ['src/other.ts', facts([9], [])],
        ]),
        matches: new Map([
          ['src/chart/chart.tsx', match(2, 'useChartData')],
          ['src/other.ts', match(1, 'useChartData')],
          ['docs/notes.md', match(1, 'useChartData')],
        ]),
        namedDefiners: new Map([['src/chart/use-chart-data.ts', 1]]),
        namedIds: new Set([7]),
        pathHits: new Set(['src/chart/chart.tsx']),
      }),
    );
    expect(ranked.map((file) => file.path).slice(0, 2)).toEqual([
      'src/chart/chart.tsx',
      'src/chart/use-chart-data.ts',
    ]);
    expect(ranked.slice(2).map((file) => file.path)).toEqual(['docs/notes.md', 'src/other.ts']);
    expect(ranked[1]).toMatchObject({ references: 1, symbols: 1, lines: 10 });
  });

  it('ranks a file referenced by the matches above an unrelated neighbour', () => {
    const ranked = rankFiles(
      input({
        facts: new Map([
          ['a.ts', facts([], [1, 2])],
          ['b.ts', facts([], [1])],
          ['lib/shared.ts', facts([1], [])],
          ['lib/unused.ts', facts([3], [])],
        ]),
        matches: new Map([
          ['a.ts', match(3, 'x')],
          ['b.ts', match(1, 'x')],
        ]),
      }),
    );
    const order = ranked.map((file) => file.path);
    expect(order.indexOf('lib/shared.ts')).toBeLessThan(order.indexOf('lib/unused.ts'));
    expect(ranked.find((file) => file.path === 'lib/shared.ts')?.reasons).toEqual([
      'linked by references',
    ]);
  });

  it('reports git signals and falls back to the package matcher for unindexed files', () => {
    const [file] = rankFiles(
      input({
        uncommitted: new Set(['web/new.ts']),
        churn: new Map([['web/new.ts', 4]]),
        packageOf: () => 'web',
      }),
    );
    expect(file).toMatchObject({
      path: 'web/new.ts',
      uncommitted: true,
      churn: 4,
      package: 'web',
      lines: null,
      hasTest: null,
      reasons: ['uncommitted'],
    });
  });

  it('caps the candidate list', () => {
    const matches = new Map(
      Array.from({ length: 300 }, (_, index) => [`f${index}.ts`, match(1, 'x')] as const),
    );
    expect(rankFiles(input({ matches }))).toHaveLength(255);
    expect(rankFiles(input({ matches, limit: 5 }))).toHaveLength(5);
  });

  it('returns nothing without evidence', () => {
    expect(rankFiles(input({}))).toEqual([]);
  });
});
