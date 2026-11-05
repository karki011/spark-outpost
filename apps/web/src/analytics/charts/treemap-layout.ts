export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function worst(row: readonly number[], side: number): number {
  const total = row.reduce((sum, value) => sum + value, 0);
  const max = Math.max(...row);
  const min = Math.min(...row);
  return Math.max((side * side * max) / (total * total), (total * total) / (side * side * min));
}

function placeRow(row: readonly number[], rect: Rect, out: Rect[]): Rect {
  const total = row.reduce((sum, value) => sum + value, 0);
  if (rect.w >= rect.h) {
    const width = total / rect.h;
    let y = rect.y;
    for (const value of row) {
      const height = value / width;
      out.push({ x: rect.x, y, w: width, h: height });
      y += height;
    }
    return { x: rect.x + width, y: rect.y, w: rect.w - width, h: rect.h };
  }
  const height = total / rect.w;
  let x = rect.x;
  for (const value of row) {
    const width = value / height;
    out.push({ x, y: rect.y, w: width, h: height });
    x += width;
  }
  return { x: rect.x, y: rect.y + height, w: rect.w, h: rect.h - height };
}

export function squarify(values: readonly number[], rect: Rect): Rect[] {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0 || rect.w <= 0 || rect.h <= 0) return values.map(() => ({ ...rect, w: 0, h: 0 }));
  const scale = (rect.w * rect.h) / total;
  const order = values.map((value, index) => ({ value: value * scale, index }));
  order.sort((a, b) => b.value - a.value);
  const placed: Rect[] = [];
  let remaining = rect;
  let row: number[] = [];
  for (const item of order) {
    const side = Math.min(remaining.w, remaining.h);
    const next = [...row, item.value];
    if (row.length === 0 || worst(next, side) <= worst(row, side)) {
      row = next;
      continue;
    }
    remaining = placeRow(row, remaining, placed);
    row = [item.value];
  }
  if (row.length > 0) placeRow(row, remaining, placed);
  const result: Rect[] = new Array(values.length);
  order.forEach((item, position) => {
    result[item.index] = placed[position]!;
  });
  return result;
}

export interface TreeLeaf {
  group: string;
  subgroup: string;
  label: string;
  value: number;
}

export interface PlacedLeaf<T extends TreeLeaf> extends Rect {
  leaf: T;
}

export interface PlacedGroup extends Rect {
  label: string;
  value: number;
}

export interface TreemapLayout<T extends TreeLeaf> {
  groups: PlacedGroup[];
  leaves: PlacedLeaf<T>[];
}

export const GROUP_HEADER = 22;
const GAP = 2;

function inset(rect: Rect, top: number, pad: number): Rect {
  return {
    x: rect.x + pad,
    y: rect.y + top,
    w: Math.max(0, rect.w - pad * 2),
    h: Math.max(0, rect.h - top - pad),
  };
}

function byKey<T>(items: readonly T[], key: (item: T) => string): [string, T[]][] {
  const map = new Map<string, T[]>();
  for (const item of items) map.set(key(item), [...(map.get(key(item)) ?? []), item]);
  return [...map.entries()];
}

const total = <T extends TreeLeaf>(leaves: readonly T[]) =>
  leaves.reduce((sum, leaf) => sum + leaf.value, 0);

export function treemap<T extends TreeLeaf>(
  leaves: readonly T[],
  width: number,
  height: number,
): TreemapLayout<T> {
  const groups = byKey(
    leaves.filter((leaf) => leaf.value > 0),
    (leaf) => leaf.group,
  );
  const groupRects = squarify(
    groups.map(([, members]) => total(members)),
    { x: 0, y: 0, w: width, h: height },
  );
  const layout: TreemapLayout<T> = { groups: [], leaves: [] };
  groups.forEach(([label, members], index) => {
    const rect = groupRects[index]!;
    layout.groups.push({ ...rect, label, value: total(members) });
    const inner = inset(rect, GROUP_HEADER, GAP);
    const subgroups = byKey(members, (leaf) => leaf.subgroup);
    const subRects = squarify(
      subgroups.map(([, subMembers]) => total(subMembers)),
      inner,
    );
    subgroups.forEach(([, subMembers], subIndex) => {
      const subRect = subRects[subIndex]!;
      const leafRects = squarify(
        subMembers.map((leaf) => leaf.value),
        subRect,
      );
      subMembers.forEach((leaf, leafIndex) => {
        const placed = leafRects[leafIndex]!;
        layout.leaves.push({
          leaf,
          x: placed.x + GAP / 2,
          y: placed.y + GAP / 2,
          w: Math.max(0, placed.w - GAP),
          h: Math.max(0, placed.h - GAP),
        });
      });
    });
  });
  return layout;
}
