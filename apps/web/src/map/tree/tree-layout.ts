import { Graph, layout } from '@dagrejs/dagre';

export interface LayoutNode {
  id: string;
  parent: string | null;
  width: number;
  height: number;
  container: boolean;
}

export interface LayoutEdge {
  source: string;
  target: string;
  weight: number;
}

export interface LayoutInput {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  columns: boolean;
}

export interface Placed {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type LayoutResult = Record<string, Placed>;

export const HEADER = 56;
export const PAD = 16;
const GAP = 22;
const RANK_GAP = 90;
const COLUMN_GAP = 180;
const ASPECT = 1.8;

interface Size {
  width: number;
  height: number;
}

interface Block extends Size {
  at: Map<string, { x: number; y: number }>;
}

function grid(ids: readonly string[], sizes: ReadonlyMap<string, Size>): Block {
  const at = new Map<string, { x: number; y: number }>();
  if (ids.length === 0) return { width: 0, height: 0, at };
  const cellW = Math.max(...ids.map((id) => sizes.get(id)!.width)) + GAP;
  const cellH = Math.max(...ids.map((id) => sizes.get(id)!.height)) + GAP;
  const columns = Math.max(1, Math.round(Math.sqrt(((ids.length * cellH) / cellW) * ASPECT)));
  ids.forEach((id, index) => {
    at.set(id, { x: (index % columns) * cellW, y: Math.floor(index / columns) * cellH });
  });
  const rows = Math.ceil(ids.length / columns);
  return {
    width: Math.min(columns, ids.length) * cellW - GAP,
    height: rows * cellH - GAP,
    at,
  };
}

function layered(
  ids: readonly string[],
  sizes: ReadonlyMap<string, Size>,
  links: ReadonlyMap<string, number>,
): Block {
  const graph = new Graph();
  graph.setGraph({ rankdir: 'LR', nodesep: GAP, ranksep: RANK_GAP, marginx: 0, marginy: 0 });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const id of ids) graph.setNode(id, { ...sizes.get(id)! });
  for (const [key, weight] of links) {
    const [source, target] = key.split('\u0000') as [string, string];
    graph.setEdge(source, target, { weight: Math.max(1, Math.round(Math.log2(weight + 1))) });
  }
  layout(graph);
  const at = new Map<string, { x: number; y: number }>();
  let width = 0;
  let height = 0;
  for (const id of ids) {
    const node = graph.node(id);
    const size = sizes.get(id)!;
    const x = node.x - size.width / 2;
    const y = node.y - size.height / 2;
    at.set(id, { x, y });
    width = Math.max(width, x + size.width);
    height = Math.max(height, y + size.height);
  }
  return { width, height, at };
}

function arrange(
  ids: readonly string[],
  sizes: ReadonlyMap<string, Size>,
  links: ReadonlyMap<string, number>,
): Block {
  const linked = new Set<string>();
  for (const key of links.keys()) for (const id of key.split('\u0000')) linked.add(id);
  const connected = ids.filter((id) => linked.has(id));
  const loose = ids.filter((id) => !linked.has(id));
  const top = connected.length > 0 ? layered(connected, sizes, links) : grid([], sizes);
  const bottom = grid(loose, sizes);
  const offset = top.height > 0 && bottom.height > 0 ? top.height + RANK_GAP / 2 : top.height;
  const at = new Map(top.at);
  for (const [id, point] of bottom.at) at.set(id, { x: point.x, y: point.y + offset });
  return {
    width: Math.max(top.width, bottom.width),
    height: offset + bottom.height,
    at,
  };
}

function columnsOf(ids: readonly string[], sizes: ReadonlyMap<string, Size>): Block {
  const at = new Map<string, { x: number; y: number }>();
  let x = 0;
  let height = 0;
  for (const id of ids) {
    const size = sizes.get(id)!;
    at.set(id, { x, y: 0 });
    x += size.width + COLUMN_GAP;
    height = Math.max(height, size.height);
  }
  return { width: Math.max(0, x - COLUMN_GAP), height, at };
}

export function layoutTree(input: LayoutInput): LayoutResult {
  const byId = new Map(input.nodes.map((node) => [node.id, node]));
  const children = new Map<string | null, string[]>();
  for (const node of input.nodes) {
    const parent = node.parent !== null && byId.has(node.parent) ? node.parent : null;
    children.set(parent, [...(children.get(parent) ?? []), node.id]);
  }
  const chain = (id: string): string[] => {
    const path: string[] = [];
    for (let at: string | null = id; at !== null; at = byId.get(at)?.parent ?? null) {
      if (!byId.has(at)) break;
      path.unshift(at);
    }
    return path;
  };
  const chains = new Map(input.nodes.map((node) => [node.id, chain(node.id)]));
  const linksAt = (container: string | null): Map<string, number> => {
    const depth = container === null ? 0 : chains.get(container)!.length;
    const links = new Map<string, number>();
    for (const edge of input.edges) {
      const a = chains.get(edge.source);
      const b = chains.get(edge.target);
      if (!a || !b) continue;
      if (container !== null && (a[depth - 1] !== container || b[depth - 1] !== container))
        continue;
      const source = a[depth];
      const target = b[depth];
      if (!source || !target || source === target) continue;
      const key = `${source}\u0000${target}`;
      links.set(key, (links.get(key) ?? 0) + edge.weight);
    }
    return links;
  };

  const sizes = new Map<string, Size>();
  const local = new Map<string, { x: number; y: number }>();
  const place = (container: string | null): Block => {
    const ids = children.get(container) ?? [];
    for (const id of ids) {
      const node = byId.get(id)!;
      if (!node.container) {
        sizes.set(id, { width: node.width, height: node.height });
        continue;
      }
      const inner = place(id);
      sizes.set(id, {
        width: Math.max(node.width, inner.width + PAD * 2),
        height: HEADER + inner.height + PAD,
      });
      for (const child of children.get(id) ?? []) {
        const point = inner.at.get(child)!;
        local.set(child, { x: point.x + PAD, y: point.y + HEADER });
      }
    }
    return container === null && input.columns
      ? columnsOf(ids, sizes)
      : arrange(ids, sizes, linksAt(container));
  };
  const root = place(null);
  for (const [id, point] of root.at) local.set(id, point);
  return Object.fromEntries(
    input.nodes.map((node) => [node.id, { ...local.get(node.id)!, ...sizes.get(node.id)! }]),
  );
}
