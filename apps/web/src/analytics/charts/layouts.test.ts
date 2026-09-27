import { describe, expect, it } from 'vitest';
import { calendarLayout, weekdayIndex } from './calendar-layout.ts';
import { linkPath, OTHER, sankeyLayout } from './sankey-layout.ts';
import { movingAverage, niceMax } from './scale.ts';
import { squarify, treemap } from './treemap-layout.ts';

const area = (rect: { w: number; h: number }) => rect.w * rect.h;

describe('calendar layout', () => {
  it('starts weeks on Monday and labels months without collisions', () => {
    expect(weekdayIndex('2026-09-21')).toBe(0);
    const days = ['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02'].map((date) => ({
      date,
      value: 1,
    }));
    const layout = calendarLayout(days);
    expect(layout.cells.map((cell) => [cell.col, cell.row])).toEqual([
      [0, 6],
      [1, 0],
      [1, 1],
      [1, 2],
    ]);
    expect(layout.weeks).toBe(2);
    expect(layout.months).toEqual([{ col: 1, label: 'Sep' }]);
    expect(calendarLayout([])).toEqual({ cells: [], weeks: 0, months: [] });
  });
});

describe('treemap layout', () => {
  it('keeps areas proportional and inside the box', () => {
    const rects = squarify([6, 3, 1], { x: 0, y: 0, w: 100, h: 50 });
    expect(rects.map(area).map(Math.round)).toEqual([3000, 1500, 500]);
    for (const rect of rects) {
      expect(rect.x + rect.w).toBeLessThanOrEqual(100.0001);
      expect(rect.y + rect.h).toBeLessThanOrEqual(50.0001);
    }
  });

  it('nests project, provider and model and skips empty leaves', () => {
    const layout = treemap(
      [
        { group: 'app', subgroup: 'claude', label: 'Sonnet', value: 3 },
        { group: 'app', subgroup: 'codex', label: 'Sol', value: 1 },
        { group: 'docs', subgroup: 'claude', label: 'Haiku', value: 2 },
        { group: 'docs', subgroup: 'claude', label: 'Opus', value: 0 },
      ],
      300,
      200,
    );
    expect(layout.groups.map((group) => [group.label, group.value])).toEqual([
      ['app', 4],
      ['docs', 2],
    ]);
    expect(layout.leaves.map((placed) => placed.leaf.label)).toEqual(['Sonnet', 'Sol', 'Haiku']);
    const app = layout.groups[0]!;
    for (const placed of layout.leaves.slice(0, 2)) {
      expect(placed.x).toBeGreaterThanOrEqual(app.x);
      expect(placed.y).toBeGreaterThan(app.y);
    }
  });
});

describe('sankey layout', () => {
  const options = { width: 400, height: 200, nodeWidth: 10, gap: 10, maxPerStage: 3 };

  it('sums flows per node and stacks links without gaps', () => {
    const layout = sankeyLayout(
      [
        { stages: ['fix', 'good'], value: 3 },
        { stages: ['fix', 'bad'], value: 1 },
        { stages: ['feature', 'good'], value: 2 },
      ],
      { ...options, order: (stage) => (stage === 1 ? ['good', 'bad'] : null) },
    );
    const byId = new Map(layout.nodes.map((node) => [node.id, node]));
    expect(byId.get('0:fix')!.value).toBe(4);
    expect(byId.get('1:good')!.value).toBe(5);
    expect(byId.get('1:good')!.y).toBeLessThan(byId.get('1:bad')!.y);
    const fromFix = layout.links.filter((link) => link.source.id === '0:fix');
    const total = fromFix.reduce((sum, link) => sum + link.w, 0);
    expect(total).toBeCloseTo(byId.get('0:fix')!.h, 6);
    expect(byId.get('1:good')!.paths).toEqual([0, 2]);
    expect(linkPath(layout.links[0]!, 10)).toMatch(/^M10,/);
  });

  it('folds small values into Other', () => {
    const layout = sankeyLayout(
      ['a', 'b', 'c', 'd'].map((key, index) => ({ stages: [key, 'x'], value: 4 - index })),
      options,
    );
    expect(
      layout.nodes.filter((node) => node.stage === 0).map((node) => [node.label, node.value]),
    ).toEqual([
      ['a', 4],
      ['b', 3],
      [OTHER, 3],
    ]);
    expect(sankeyLayout([], options)).toEqual({ nodes: [], links: [] });
  });
});

describe('scales', () => {
  it('rounds axis maxima and averages trailing windows', () => {
    expect([niceMax(0), niceMax(0.83), niceMax(1.2), niceMax(37)]).toEqual([1, 1, 2, 50]);
    expect(movingAverage([2, 4, 6, 8], 2)).toEqual([2, 3, 5, 7]);
  });
});
