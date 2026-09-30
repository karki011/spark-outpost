import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import type { NetworkRequest, NetworkUpdate } from './network-messages.ts';

interface Node extends SimulationNodeDatum {
  r: number;
}

type Link = SimulationLinkDatum<Node>;

const FRAME_MS = 16;
const WARM_TICKS = 300;
const SETTLED_TICKS = 420;

let simulation: Simulation<Node, undefined> | null = null;
let nodes: Node[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;

function post(done: boolean) {
  const buffer = new Float32Array(nodes.length * 2);
  nodes.forEach((node, index) => {
    buffer[index * 2] = node.x ?? 0;
    buffer[index * 2 + 1] = node.y ?? 0;
  });
  const update: NetworkUpdate = { positions: buffer, done };
  self.postMessage(update, { transfer: [buffer.buffer] });
}

function run() {
  clearTimeout(timer);
  if (!simulation) return;
  simulation.tick();
  const done = simulation.alpha() < simulation.alphaMin();
  post(done);
  if (!done) timer = setTimeout(run, FRAME_MS);
}

function start(request: Extract<NetworkRequest, { type: 'start' }>) {
  clearTimeout(timer);
  nodes = request.nodes.map((node) => ({ x: node.x, y: node.y, r: node.r }));
  const links: Link[] = request.links.map(([source, target]) => ({ source, target }));
  const nodeOf = (end: Link['source']): Node =>
    typeof end === 'object' ? end : (nodes[Number(end)] as Node);
  const degree = new Array<number>(nodes.length).fill(0);
  for (const [a, b] of request.links) {
    degree[a] = (degree[a] ?? 0) + 1;
    degree[b] = (degree[b] ?? 0) + 1;
  }
  simulation = forceSimulation(nodes)
    .force('charge', forceManyBody<Node>().strength(-140).distanceMax(320))
    .force(
      'link',
      forceLink<Node, Link>(links)
        .distance((link) => 16 + nodeOf(link.source).r + nodeOf(link.target).r)
        .strength((link) => {
          const a = degree[nodeOf(link.source).index ?? 0] || 1;
          const b = degree[nodeOf(link.target).index ?? 0] || 1;
          return 0.7 / Math.min(a, b, 6);
        }),
    )
    .force(
      'collide',
      forceCollide<Node>((node) => node.r + 4),
    )
    .force('x', forceX<Node>(request.cx).strength(0.04))
    .force('y', forceY<Node>(request.cy).strength(0.04))
    .stop();
  const ticks = request.settle ? SETTLED_TICKS : WARM_TICKS;
  for (let i = 0; i < ticks; i += 1) simulation.tick();
  if (request.settle) {
    post(true);
    return;
  }
  simulation.alpha(0.12);
  post(false);
  timer = setTimeout(run, FRAME_MS);
}

self.onmessage = (event: MessageEvent<NetworkRequest>) => {
  const request = event.data;
  if (request.type === 'start') {
    start(request);
    return;
  }
  if (request.type === 'stop') {
    clearTimeout(timer);
    simulation = null;
    return;
  }
  const node = nodes[request.index];
  if (!node || !simulation) return;
  if (request.type === 'drag') {
    node.fx = request.x;
    node.fy = request.y;
    simulation.alphaTarget(0.2);
  } else {
    node.fx = null;
    node.fy = null;
    simulation.alphaTarget(0);
  }
  if (simulation.alpha() < 0.1) simulation.alpha(0.1);
  run();
};
