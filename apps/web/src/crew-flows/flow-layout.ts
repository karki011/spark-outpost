import { Graph, layout } from '@dagrejs/dagre';

export interface FlowLayoutInput {
  nodes: { id: string }[];
  edges: { source: string; target: string }[];
}

export interface FlowPoint {
  x: number;
  y: number;
}

export interface FlowLayoutResult {
  at: Record<string, FlowPoint>;
  width: number;
  height: number;
}

export const FLOW_NODE_WIDTH = 176;
export const FLOW_NODE_HEIGHT = 52;
const NODE_GAP = 18;
const RANK_GAP = 72;

export function layoutFlow(input: FlowLayoutInput): FlowLayoutResult {
  const graph = new Graph();
  graph.setGraph({ rankdir: 'LR', nodesep: NODE_GAP, ranksep: RANK_GAP, marginx: 0, marginy: 0 });
  graph.setDefaultEdgeLabel(() => ({}));
  const known = new Set(input.nodes.map((node) => node.id));
  for (const node of input.nodes) {
    graph.setNode(node.id, { width: FLOW_NODE_WIDTH, height: FLOW_NODE_HEIGHT });
  }
  for (const edge of input.edges) {
    if (known.has(edge.source) && known.has(edge.target) && edge.source !== edge.target) {
      graph.setEdge(edge.source, edge.target);
    }
  }
  layout(graph);
  const ranks = new Map<number, string[]>();
  for (const node of input.nodes) {
    const rank = Math.round(graph.node(node.id).x);
    ranks.set(rank, [...(ranks.get(rank) ?? []), node.id]);
  }
  const at: Record<string, FlowPoint> = {};
  let width = 0;
  let height = 0;
  for (const [rank, members] of ranks) {
    const rows = members.map((id) => graph.node(id).y).sort((a, b) => a - b);
    members.forEach((id, index) => {
      const x = rank - FLOW_NODE_WIDTH / 2;
      const y = rows[index]! - FLOW_NODE_HEIGHT / 2;
      at[id] = { x, y };
      width = Math.max(width, x + FLOW_NODE_WIDTH);
      height = Math.max(height, y + FLOW_NODE_HEIGHT);
    });
  }
  return { at, width, height };
}
