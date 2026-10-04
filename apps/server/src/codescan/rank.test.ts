import { describe, expect, it } from 'vitest';
import {
  nameWeight,
  personalisedPageRank,
  rankFiles,
  strongestNodes,
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
  it('puts a named path and the definer of a named symbol ahead of plain matches', async () => {
    const ranked = await rankFiles(
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

  it('ranks a file referenced by the matches above an unrelated neighbour', async () => {
    const ranked = await rankFiles(
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

  it('reports git signals and falls back to the package matcher for unindexed files', async () => {
    const [file] = await rankFiles(
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

  it('lifts files whose paths contain words from the request', async () => {
    const ranked = await rankFiles(
      input({
        matches: new Map([['src/other.ts', match(1, 'x')]]),
        pathWords: new Map([['src/sidebar/sidebar-order.ts', 2]]),
      }),
    );
    expect(ranked[0]).toMatchObject({
      path: 'src/sidebar/sidebar-order.ts',
      reasons: ['path words'],
    });
  });

  it('pushes down hub files that are only linked by references', async () => {
    const base = {
      facts: new Map([
        ['feature/a.ts', facts([], [1, 2])],
        ['shared/tokens.ts', facts([1], [])],
        ['feature/helper.ts', facts([2], [])],
      ]),
      matches: new Map([['feature/a.ts', match(2, 'x')]]),
      nameStats: new Map([
        [1, { defFiles: 1, refFiles: 900 }],
        [2, { defFiles: 1, refFiles: 3 }],
      ]),
    };
    const plain = (await rankFiles(input(base))).map((file) => file.path);
    const damped = (await rankFiles(input({ ...base, hubCap: 50 }))).map((file) => file.path);
    expect(damped.indexOf('shared/tokens.ts')).toBeGreaterThan(damped.indexOf('feature/helper.ts'));
    expect(damped[0]).toBe('feature/a.ts');
    expect(plain).toHaveLength(3);
  });

  it('caps the candidate list', async () => {
    const matches = new Map(
      Array.from({ length: 300 }, (_, index) => [`f${index}.ts`, match(1, 'x')] as const),
    );
    expect(await rankFiles(input({ matches }))).toHaveLength(255);
    expect(await rankFiles(input({ matches, limit: 5 }))).toHaveLength(5);
  });

  it('returns nothing without evidence', async () => {
    expect(await rankFiles(input({}))).toEqual([]);
  });
});

describe('ranking when most files match', () => {
  const strong = new Map([
    ['core/engine.ts', facts([1], [2])],
    ['core/helper.ts', facts([2], [])],
    ['core/linked-only.ts', facts([], [1])],
  ]);

  function crowded(order: 'forward' | 'backward'): RankInput {
    const weak = Array.from(
      { length: 3_000 },
      (_, index) => [`many/file-${String(index).padStart(4, '0')}.ts`, match(1, 'x')] as const,
    );
    const better = [
      ['some/twice-a.ts', match(3, 'x', 'y')] as const,
      ['some/twice-b.ts', match(2, 'x', 'y')] as const,
    ];
    const listed = [...weak, ...better, ['core/engine.ts', match(3, 'x', 'y')] as const];
    return input({
      facts: strong,
      matches: new Map(order === 'forward' ? listed : listed.reverse()),
      namedDefiners: new Map([['core/engine.ts', 1]]),
      namedIds: new Set([1]),
      nodeCap: 500,
    });
  }

  it('gives the same ranking whatever order the matches arrive in', async () => {
    const forward = await rankFiles(crowded('forward'));
    const backward = await rankFiles(crowded('backward'));
    expect(backward).toEqual(forward);
    expect(forward).toHaveLength(255);
  });

  it('keeps linked files and the strongest matches, then the earliest paths among equals', async () => {
    const ranked = (await rankFiles(crowded('forward'))).map((file) => file.path);
    expect(ranked[0]).toBe('core/engine.ts');
    expect(ranked.slice(0, 5)).toEqual(
      expect.arrayContaining(['core/helper.ts', 'some/twice-a.ts', 'some/twice-b.ts']),
    );
    const weak = ranked.filter((path) => path.startsWith('many/'));
    expect(weak[0]).toBe('many/file-0000.ts');
    expect(weak.at(-1)).toBe(`many/file-${String(weak.length - 1).padStart(4, '0')}.ts`);
  });

  it('ranks exactly as without a cap while the files fit under it', async () => {
    const few = { ...crowded('forward'), nodeCap: 4_000 };
    const uncapped = { ...crowded('forward'), nodeCap: Infinity };
    expect(await rankFiles(few)).toEqual(await rankFiles(uncapped));
  });

  it('selects every linked file, then unlinked ones by evidence and path, in path order', async () => {
    const paths = ['d.ts', 'b.ts', 'f.ts', 'a.ts', 'e.ts', 'c.ts'];
    const evidence = [1, 5, 9, 1, 0, 1];
    const linked = new Map([['e.ts', facts([], [])]]);
    const picked = async (cap: number, known = linked) =>
      (await strongestNodes(paths, evidence, known, cap)).map((index) => paths[index]);
    expect(await picked(6)).toEqual(['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts']);
    expect(await picked(4)).toEqual(['a.ts', 'b.ts', 'e.ts', 'f.ts']);
    expect(await picked(5)).toEqual(['a.ts', 'b.ts', 'c.ts', 'e.ts', 'f.ts']);
    expect(await picked(1)).toEqual(['e.ts']);
    expect(await picked(2, new Map())).toEqual(['b.ts', 'f.ts']);
  });
});
