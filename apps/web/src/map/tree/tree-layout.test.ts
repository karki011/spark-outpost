import { describe, expect, it } from 'vitest';
import { HEADER, layoutTree, PAD, type LayoutNode, type Placed } from './tree-layout.ts';

const leaf = (id: string, parent: string | null = null): LayoutNode => ({
  id,
  parent,
  width: 200,
  height: 80,
  container: false,
});

const overlaps = (a: Placed, b: Placed) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe('layoutTree', () => {
  it('puts importers left of what they import', () => {
    const result = layoutTree({
      nodes: [leaf('feature'), leaf('shared'), leaf('core')],
      edges: [
        { source: 'feature', target: 'shared', weight: 4 },
        { source: 'shared', target: 'core', weight: 9 },
      ],
      columns: false,
    });
    expect(result.feature!.x).toBeLessThan(result.shared!.x);
    expect(result.shared!.x).toBeLessThan(result.core!.x);
  });

  it('keeps unlinked nodes in a tidy grid below the linked ones, with no overlaps', () => {
    const nodes = [
      leaf('a'),
      leaf('b'),
      ...Array.from({ length: 9 }, (_, i) => leaf(`loose-${i}`)),
    ];
    const result = layoutTree({
      nodes,
      edges: [{ source: 'a', target: 'b', weight: 1 }],
      columns: false,
    });
    const placed = nodes.map((node) => result[node.id]!);
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1)
        expect(overlaps(placed[i]!, placed[j]!)).toBe(false);
    }
    expect(result['loose-0']!.y).toBeGreaterThan(result.a!.y + 80);
  });

  it('sizes an open container around its children, placed relative to it', () => {
    const result = layoutTree({
      nodes: [
        { id: 'group', parent: null, width: 240, height: 100, container: true },
        leaf('x', 'group'),
        leaf('y', 'group'),
        leaf('other'),
      ],
      edges: [
        { source: 'x', target: 'y', weight: 1 },
        { source: 'y', target: 'other', weight: 3 },
      ],
      columns: false,
    });
    const group = result.group!;
    expect(result.x).toMatchObject({ x: PAD, y: HEADER });
    expect(result.y!.x).toBeGreaterThan(result.x!.x);
    expect(group.width).toBeGreaterThanOrEqual(result.y!.x + 200 + PAD);
    expect(group.height).toBeGreaterThanOrEqual(HEADER + 80 + PAD);
    expect(result.other!.x).toBeGreaterThan(group.x + group.width);
  });

  it('lays projects out as side by side columns', () => {
    const result = layoutTree({
      nodes: [
        { id: 'web', parent: null, width: 300, height: 100, container: true },
        { id: 'server', parent: null, width: 300, height: 100, container: true },
        leaf('w', 'web'),
        leaf('s', 'server'),
      ],
      edges: [{ source: 'w', target: 's', weight: 1 }],
      columns: true,
    });
    expect(result.web!.y).toBe(result.server!.y);
    expect(result.server!.x).toBeGreaterThan(result.web!.x + result.web!.width);
  });
});
