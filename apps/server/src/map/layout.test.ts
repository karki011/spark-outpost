import { describe, expect, it } from 'vitest';
import { FILE_LAYOUT, layoutNodes, type LayoutNode } from './layout.ts';

function nodes(
  count: number,
  previous: Map<string, { x: number; y: number }> = new Map(),
): LayoutNode[] {
  return Array.from({ length: count }, (_, index) => {
    const id = `src/file-${index}.ts`;
    return { id, size: 2, weight: index / count, previous: previous.get(id) ?? null };
  });
}

const EDGES = [
  { from: 'src/file-0.ts', to: 'src/file-1.ts', weight: 1 },
  { from: 'src/file-1.ts', to: 'src/file-2.ts', weight: 1 },
  { from: 'src/file-5.ts', to: 'src/file-0.ts', weight: 1 },
];

describe('layoutNodes', () => {
  it('is deterministic for the same input', () => {
    expect(layoutNodes(nodes(12), EDGES, FILE_LAYOUT)).toEqual(
      layoutNodes(nodes(12), EDGES, FILE_LAYOUT),
    );
  });

  it('spreads nodes apart so none overlap', () => {
    const points = [...layoutNodes(nodes(30), EDGES, FILE_LAYOUT).values()];
    for (const [index, a] of points.entries()) {
      for (const b of points.slice(index + 1))
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(2);
    }
  });

  it('moves only new nodes on an incremental layout', () => {
    const first = layoutNodes(nodes(12), EDGES, FILE_LAYOUT);
    const next = layoutNodes(
      nodes(14, first),
      [...EDGES, { from: 'src/file-13.ts', to: 'src/file-0.ts', weight: 1 }],
      FILE_LAYOUT,
    );
    for (const [id, point] of first) expect(next.get(id)).toEqual(point);
    const added = next.get('src/file-13.ts');
    const anchor = first.get('src/file-0.ts');
    expect(added && anchor && Math.hypot(added.x - anchor.x, added.y - anchor.y)).toBeLessThan(80);
  });

  it('places very large areas on a spiral instead of simulating forces', () => {
    const big = layoutNodes(nodes(FILE_LAYOUT.forceLimit + 5), [], FILE_LAYOUT);
    expect(big.size).toBe(FILE_LAYOUT.forceLimit + 5);
    const heaviest = big.get(`src/file-${FILE_LAYOUT.forceLimit + 4}.ts`);
    expect(heaviest && Math.hypot(heaviest.x, heaviest.y)).toBeLessThan(FILE_LAYOUT.spacing);
  });
});
