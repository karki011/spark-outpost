import { createHash } from 'node:crypto';

export interface Point {
  x: number;
  y: number;
}

export interface LayoutNode {
  id: string;
  size: number;
  weight: number;
  previous: Point | null;
}

export interface LayoutEdge {
  from: string;
  to: string;
  weight: number;
}

export interface LayoutOptions {
  spacing: number;
  iterations: number;
  forceLimit: number;
}

export const FILE_LAYOUT: LayoutOptions = { spacing: 12, iterations: 160, forceLimit: 400 };
export const SKY_LAYOUT: LayoutOptions = { spacing: 40, iterations: 240, forceLimit: 2_000 };

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

function seed(text: string): number {
  return createHash('sha1').update(text).digest().readUInt32LE(0);
}

function seededPoint(id: string, radius: number): Point {
  const value = seed(id);
  const angle = ((value & 0xffff) / 0xffff) * Math.PI * 2;
  const distance = Math.sqrt((value >>> 16) / 0xffff) * radius;
  return { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance };
}

function round(point: Point): Point {
  return { x: Math.round(point.x * 10) / 10, y: Math.round(point.y * 10) / 10 };
}

interface Body {
  id: string;
  x: number;
  y: number;
  size: number;
  pinned: boolean;
}

function neighbourCentre(id: string, edges: readonly LayoutEdge[], placed: Map<string, Body>) {
  let x = 0;
  let y = 0;
  let count = 0;
  for (const edge of edges) {
    const other = edge.from === id ? edge.to : edge.to === id ? edge.from : null;
    const body = other ? placed.get(other) : undefined;
    if (!body || !body.pinned) continue;
    x += body.x;
    y += body.y;
    count += 1;
  }
  return count > 0 ? { x: x / count, y: y / count } : null;
}

function initialBodies(nodes: readonly LayoutNode[], edges: readonly LayoutEdge[], spread: number) {
  const bodies = new Map<string, Body>();
  for (const node of nodes) {
    if (node.previous)
      bodies.set(node.id, { id: node.id, ...node.previous, size: node.size, pinned: true });
  }
  const incremental = bodies.size > 0;
  for (const node of nodes) {
    if (node.previous) continue;
    const jitter = seededPoint(node.id, node.size + spread * 0.2);
    const centre = incremental ? neighbourCentre(node.id, edges, bodies) : null;
    const start = centre
      ? { x: centre.x + jitter.x, y: centre.y + jitter.y }
      : seededPoint(node.id, spread);
    bodies.set(node.id, { id: node.id, ...start, size: node.size, pinned: false });
  }
  return { bodies: [...bodies.values()].sort((a, b) => a.id.localeCompare(b.id)), incremental };
}

function step(bodies: Body[], links: [number, number, number][], spacing: number, heat: number) {
  const forces = bodies.map(() => ({ x: 0, y: 0 }));
  for (let a = 0; a < bodies.length; a += 1) {
    const left = bodies[a] as Body;
    for (let b = a + 1; b < bodies.length; b += 1) {
      const right = bodies[b] as Body;
      let dx = left.x - right.x;
      let dy = left.y - right.y;
      if (dx === 0 && dy === 0) {
        dx = 0.01 * (a + 1);
        dy = 0.01 * (b + 1);
      }
      const distance = Math.hypot(dx, dy);
      const reach = left.size + right.size + spacing;
      const push = (reach * reach) / (distance * distance + 1);
      const fa = forces[a] as Point;
      const fb = forces[b] as Point;
      fa.x += (dx / distance) * push;
      fa.y += (dy / distance) * push;
      fb.x -= (dx / distance) * push;
      fb.y -= (dy / distance) * push;
    }
  }
  for (const [a, b, weight] of links) {
    const left = bodies[a] as Body;
    const right = bodies[b] as Body;
    const dx = right.x - left.x;
    const dy = right.y - left.y;
    const distance = Math.hypot(dx, dy) || 1;
    const rest = left.size + right.size + spacing;
    const pull = Math.min(2, weight) * 0.05 * (distance - rest);
    const fa = forces[a] as Point;
    const fb = forces[b] as Point;
    fa.x += (dx / distance) * pull;
    fa.y += (dy / distance) * pull;
    fb.x -= (dx / distance) * pull;
    fb.y -= (dy / distance) * pull;
  }
  bodies.forEach((body, index) => {
    if (body.pinned) return;
    const force = forces[index] as Point;
    const gravity = 0.01;
    force.x -= body.x * gravity;
    force.y -= body.y * gravity;
    const length = Math.hypot(force.x, force.y);
    const move = Math.min(length, heat);
    if (length > 0) {
      body.x += (force.x / length) * move;
      body.y += (force.y / length) * move;
    }
  });
}

function spiral(nodes: readonly LayoutNode[], spacing: number): Map<string, Point> {
  const ordered = [...nodes].sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id));
  const positions = new Map<string, Point>();
  const incremental = nodes.some((node) => node.previous);
  let slot = 0;
  for (const node of ordered) {
    if (node.previous) {
      positions.set(node.id, node.previous);
      continue;
    }
    while (slot < ordered.length * 4) {
      const radius = spacing * 0.6 * Math.sqrt(slot + 0.5);
      const point = round({
        x: Math.cos(slot * GOLDEN_ANGLE) * radius,
        y: Math.sin(slot * GOLDEN_ANGLE) * radius,
      });
      slot += 1;
      const taken =
        incremental &&
        [...positions.values()].some(
          (other) => Math.hypot(other.x - point.x, other.y - point.y) < spacing * 0.5,
        );
      if (!taken) {
        positions.set(node.id, point);
        break;
      }
    }
  }
  return positions;
}

export function layoutNodes(
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
  options: LayoutOptions,
): Map<string, Point> {
  if (nodes.length === 0) return new Map();
  if (nodes.length > options.forceLimit) return spiral(nodes, options.spacing);
  const spread = options.spacing * Math.sqrt(nodes.length) * 1.5;
  const { bodies, incremental } = initialBodies(nodes, edges, spread);
  if (bodies.every((body) => body.pinned))
    return new Map(bodies.map((body) => [body.id, round(body)]));
  const index = new Map(bodies.map((body, position) => [body.id, position]));
  const links: [number, number, number][] = edges.flatMap((edge) => {
    const a = index.get(edge.from);
    const b = index.get(edge.to);
    return a === undefined || b === undefined || a === b ? [] : [[a, b, edge.weight]];
  });
  const iterations = incremental ? Math.ceil(options.iterations / 2) : options.iterations;
  for (let turn = 0; turn < iterations; turn += 1) {
    const heat = options.spacing * 2 * (1 - turn / iterations) + 0.5;
    step(bodies, links, options.spacing, heat);
  }
  return new Map(bodies.map((body) => [body.id, round(body)]));
}

export function extent(positions: Iterable<Point>, padding: number): number {
  let radius = 0;
  for (const point of positions) radius = Math.max(radius, Math.hypot(point.x, point.y));
  return Math.round((radius + padding) * 10) / 10;
}
