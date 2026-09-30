import type { NavBox } from './tree-nav.ts';
import type { FlowNode } from './TreeNodes.tsx';
import type { LayoutResult, Placed } from './tree-layout.ts';
import type { TreeItem } from './tree-model.ts';

const PLAIN_NODE = { 'aria-roledescription': undefined };

export function absolute(items: readonly TreeItem[], result: LayoutResult): Map<string, NavBox> {
  const boxes = new Map<string, NavBox>();
  for (const item of items) {
    const placed = result[item.id];
    if (!placed) continue;
    const parent = item.parent ? boxes.get(item.parent) : undefined;
    boxes.set(item.id, {
      id: item.id,
      x: placed.x + (parent?.x ?? 0),
      y: placed.y + (parent?.y ?? 0),
      width: placed.width,
      height: placed.height,
    });
  }
  return boxes;
}

function samePlace(node: FlowNode, placed: Placed): boolean {
  return (
    node.position.x === placed.x &&
    node.position.y === placed.y &&
    node.width === placed.width &&
    node.height === placed.height
  );
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function sameItem(a: TreeItem, b: TreeItem): boolean {
  const left = a as unknown as Record<string, unknown>;
  const right = b as unknown as Record<string, unknown>;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => sameValue(left[key], right[key]))
  );
}

export function nameOf(item: TreeItem): string {
  if (item.kind === 'group') return item.group.name;
  if (item.kind === 'area') return item.area.name;
  if (item.kind === 'folder') return `${item.path}/`;
  return '';
}

export function flowNodes(
  items: readonly TreeItem[],
  result: LayoutResult,
  cache: Map<string, FlowNode>,
): FlowNode[] {
  return items.flatMap((item) => {
    const placed = result[item.id];
    if (!placed || (item.parent && !result[item.parent])) return [];
    const cached = cache.get(item.id);
    if (cached && samePlace(cached, placed) && sameItem(cached.data.item, item)) return [cached];
    const node: FlowNode = {
      id: item.id,
      type: item.kind,
      position: { x: placed.x, y: placed.y },
      ...(item.parent ? { parentId: item.parent } : {}),
      data: { item },
      width: placed.width,
      height: placed.height,
      style: { width: placed.width, height: placed.height },
      draggable: false,
      selectable: false,
      focusable: false,
      domAttributes: PLAIN_NODE,
    };
    cache.set(item.id, node);
    return [node];
  });
}
