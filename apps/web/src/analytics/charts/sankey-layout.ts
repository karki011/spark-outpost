export interface SankeyPath {
  stages: readonly string[];
  value: number;
}

export interface SankeyNode {
  id: string;
  stage: number;
  label: string;
  value: number;
  x: number;
  y: number;
  h: number;
  paths: number[];
}

export interface SankeyLink {
  id: string;
  source: SankeyNode;
  target: SankeyNode;
  value: number;
  sy: number;
  ty: number;
  w: number;
  paths: number[];
}

export interface SankeyLayout {
  nodes: SankeyNode[];
  links: SankeyLink[];
}

export interface SankeyOptions {
  width: number;
  height: number;
  nodeWidth: number;
  gap: number;
  maxPerStage: number;
  order?: (stage: number) => readonly string[] | null;
}

export const OTHER = 'Other';

function foldedStages(paths: readonly SankeyPath[], options: SankeyOptions): string[][] {
  const stageCount = paths[0]?.stages.length ?? 0;
  const keep: Set<string>[] = [];
  for (let stage = 0; stage < stageCount; stage++) {
    const totals = new Map<string, number>();
    for (const path of paths) {
      const key = path.stages[stage]!;
      totals.set(key, (totals.get(key) ?? 0) + path.value);
    }
    const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([key]) => key);
    const limit = ranked.length > options.maxPerStage ? options.maxPerStage - 1 : ranked.length;
    keep.push(new Set(ranked.slice(0, limit)));
  }
  return paths.map((path) =>
    path.stages.map((key, stage) => (keep[stage]!.has(key) ? key : OTHER)),
  );
}

function sortNodes(nodes: SankeyNode[], order: readonly string[] | null): SankeyNode[] {
  return nodes.sort((a, b) => {
    if (a.label === OTHER || b.label === OTHER) return a.label === OTHER ? 1 : -1;
    if (order) return order.indexOf(a.label) - order.indexOf(b.label);
    return b.value - a.value;
  });
}

export function sankeyLayout(paths: readonly SankeyPath[], options: SankeyOptions): SankeyLayout {
  if (paths.length === 0) return { nodes: [], links: [] };
  const stages = foldedStages(paths, options);
  const stageCount = stages[0]!.length;
  const nodeMap = new Map<string, SankeyNode>();
  const linkMap = new Map<string, SankeyLink>();
  const node = (stage: number, label: string) => {
    const id = `${stage}:${label}`;
    let found = nodeMap.get(id);
    if (!found) {
      found = { id, stage, label, value: 0, x: 0, y: 0, h: 0, paths: [] };
      nodeMap.set(id, found);
    }
    return found;
  };
  stages.forEach((keys, pathIndex) => {
    const value = paths[pathIndex]!.value;
    const chain = keys.map((key, stage) => node(stage, key));
    for (const member of chain) {
      member.value += value;
      member.paths.push(pathIndex);
    }
    for (let stage = 0; stage < stageCount - 1; stage++) {
      const id = `${chain[stage]!.id}->${chain[stage + 1]!.id}`;
      let link = linkMap.get(id);
      if (!link) {
        link = {
          id,
          source: chain[stage]!,
          target: chain[stage + 1]!,
          value: 0,
          sy: 0,
          ty: 0,
          w: 0,
          paths: [],
        };
        linkMap.set(id, link);
      }
      link.value += value;
      link.paths.push(pathIndex);
    }
  });
  const total = paths.reduce((sum, path) => sum + path.value, 0);
  const columns = Array.from({ length: stageCount }, (_, stage) =>
    sortNodes(
      [...nodeMap.values()].filter((entry) => entry.stage === stage),
      options.order?.(stage) ?? null,
    ),
  );
  const busiest = Math.max(...columns.map((column) => column.length));
  const scale = (options.height - (busiest - 1) * options.gap) / total;
  const step = (options.width - options.nodeWidth) / Math.max(1, stageCount - 1);
  columns.forEach((column, stage) => {
    const used = total * scale + (column.length - 1) * options.gap;
    let y = (options.height - used) / 2;
    for (const entry of column) {
      entry.x = stage * step;
      entry.y = y;
      entry.h = Math.max(1, entry.value * scale);
      y += entry.value * scale + options.gap;
    }
  });
  const links = [...linkMap.values()];
  for (const link of links) link.w = link.value * scale;
  for (const entry of nodeMap.values()) {
    let offset = entry.y;
    for (const link of links
      .filter((candidate) => candidate.source === entry)
      .sort((a, b) => a.target.y - b.target.y)) {
      link.sy = offset;
      offset += link.w;
    }
    offset = entry.y;
    for (const link of links
      .filter((candidate) => candidate.target === entry)
      .sort((a, b) => a.source.y - b.source.y)) {
      link.ty = offset;
      offset += link.w;
    }
  }
  return { nodes: columns.flat(), links };
}

export function linkPath(link: SankeyLink, nodeWidth: number): string {
  const x0 = link.source.x + nodeWidth;
  const x1 = link.target.x;
  const middle = (x0 + x1) / 2;
  const { sy, ty, w } = link;
  return [
    `M${x0},${sy}`,
    `C${middle},${sy} ${middle},${ty} ${x1},${ty}`,
    `L${x1},${ty + w}`,
    `C${middle},${ty + w} ${middle},${sy + w} ${x0},${sy + w}`,
    'Z',
  ].join(' ');
}
