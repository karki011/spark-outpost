import { el } from '../dom.ts';
import { scrollProgress } from '../motion.ts';

interface GraphEvent {
  lane: 'main' | 'branch';
  kind: 'start' | 'commit' | 'pr' | 'review' | 'merge';
  text: string;
}

const EVENTS: GraphEvent[] = [
  { lane: 'main', kind: 'start', text: 'You ask: fix the flaky checkout test' },
  { lane: 'branch', kind: 'commit', text: 'spark/fix-checkout starts in its own worktree' },
  { lane: 'branch', kind: 'commit', text: 'Patch the race in cart.ts' },
  { lane: 'branch', kind: 'commit', text: 'Add a regression test · 3 of 3 pass' },
  { lane: 'branch', kind: 'pr', text: 'Pull request #128 opened' },
  { lane: 'branch', kind: 'review', text: 'Review comment: handle an empty cart' },
  { lane: 'branch', kind: 'commit', text: 'Follow-up fix pushed to the same branch' },
  { lane: 'main', kind: 'merge', text: 'Merge: your click. Spark never merges for you.' },
];

const ROW = 56;
const MAIN_X = 18;
const BRANCH_X = 54;
const SVG_NS = 'http://www.w3.org/2000/svg';

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
  return element;
}

function rowY(index: number): number {
  return index * ROW + ROW / 2;
}

function branchPath(): string {
  const first = rowY(0);
  const last = rowY(EVENTS.length - 2);
  return `M ${MAIN_X} ${first} C ${MAIN_X} ${first + 30}, ${BRANCH_X} ${first + 24}, ${BRANCH_X} ${rowY(1)} L ${BRANCH_X} ${last}`;
}

function mergePath(): string {
  const from = rowY(EVENTS.length - 2);
  const to = rowY(EVENTS.length - 1);
  return `M ${BRANCH_X} ${from} C ${BRANCH_X} ${from + 30}, ${MAIN_X} ${to - 30}, ${MAIN_X} ${to}`;
}

export function mountBranchGraph(host: HTMLElement, still: boolean): void {
  const height = EVENTS.length * ROW;
  const graph = el('div', 'branch-graph');
  const drawing = svg('svg', {
    viewBox: `0 0 72 ${height}`,
    width: 72,
    height,
    'aria-hidden': 'true',
  });
  drawing.append(svg('line', { x1: MAIN_X, y1: 0, x2: MAIN_X, y2: height, class: 'lane-main' }));
  const branch = svg('path', { d: branchPath(), class: 'lane-branch', pathLength: 1 });
  const merge = svg('path', { d: mergePath(), class: 'lane-merge' });
  drawing.append(branch, merge);
  const nodes = EVENTS.map((event, index) => {
    const node = svg('circle', {
      cx: event.lane === 'main' ? MAIN_X : BRANCH_X,
      cy: rowY(index),
      r: event.kind === 'pr' ? 9 : 6,
      class: `node node-${event.kind}`,
    });
    drawing.append(node);
    return node;
  });

  const list = el('ol', 'branch-events');
  const items = EVENTS.map((event) => {
    const item = el('li', `event event-${event.kind}`, event.text);
    list.append(item);
    return item;
  });
  graph.append(drawing, list);
  host.append(graph);

  const show = (progress: number) => {
    const reached = progress * (EVENTS.length - 1) + 0.15;
    branch.style.strokeDashoffset = String(1 - Math.min(1, progress * 1.15));
    EVENTS.forEach((_event, index) => {
      const on = index <= reached;
      nodes[index]!.classList.toggle('on', on);
      items[index]!.classList.toggle('on', on);
    });
    merge.classList.toggle('on', reached >= EVENTS.length - 1);
  };

  if (still) {
    show(1);
    return;
  }
  scrollProgress(host, show);
}
