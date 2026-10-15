import { describeTarget } from './act-target.ts';
import type { Cdp } from './cdp.ts';
import { PageToolError } from './page-read.ts';

export interface Point {
  x: number;
  y: number;
}

export interface AimContext {
  filled: ReadonlySet<number>;
  label: string;
}

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

type ProbeMode = 'aim' | 'see';
type Probe =
  | { state: 'clear'; index: number }
  | { state: 'covered'; index: number }
  | { state: 'hidden' | 'inert' | 'offscreen' };

export const ACT_NOT_VISIBLE = 'That element is not visible on the page. Read the page again.';

const WORLD = 'spark-act';
const GROUP = 'spark-act';
const SPOTS: ReadonlyArray<readonly [number, number]> = [
  [0.5, 0.5],
  [0.5, 0.15],
  [0.5, 0.85],
  [0.15, 0.5],
  [0.85, 0.5],
  [0.15, 0.15],
  [0.85, 0.15],
  [0.15, 0.85],
  [0.85, 0.85],
];

export const HIT_PROBE = `function (points, mode) {
  const target = this;
  const frameOf = (doc) => {
    try {
      return doc.defaultView ? doc.defaultView.frameElement : null;
    } catch (error) {
      return null;
    }
  };
  const up = (node) => {
    const parent = node.parentNode;
    if (!parent) return null;
    if (parent.nodeType === 11) return parent.host;
    if (parent.nodeType === 9) return frameOf(parent);
    return parent;
  };
  const styleOf = (element) => element.ownerDocument.defaultView.getComputedStyle(element);
  const holds = (outer, inner) => {
    for (let node = inner; node; node = up(node)) if (node === outer) return true;
    return false;
  };
  const steps = [];
  for (let node = target; node; ) {
    const root = node.getRootNode();
    const via = root.nodeType === 11 ? root.host : root.nodeType === 9 ? frameOf(root) : null;
    steps.unshift({ root, via });
    node = via;
  }
  const hitAt = (point) => {
    let x = point.x;
    let y = point.y;
    let hit = null;
    for (const step of steps) {
      if (step.via) {
        if (hit !== step.via) return hit;
        if (step.root.nodeType === 9) {
          const box = step.via.getBoundingClientRect();
          const style = styleOf(step.via);
          x -= box.left + step.via.clientLeft + parseFloat(style.paddingLeft);
          y -= box.top + step.via.clientTop + parseFloat(style.paddingTop);
        }
      }
      if (typeof step.root.elementFromPoint !== 'function') return null;
      hit = step.root.elementFromPoint(x, y);
    }
    return hit;
  };
  const marked = (element) =>
    element.nodeType === 1 &&
    (element.tagName === 'DIALOG' ||
      element.hasAttribute('role') ||
      element.hasAttribute('aria-label') ||
      ['fixed', 'sticky'].includes(styleOf(element).position));
  if (mode === 'cover') {
    const hit = hitAt(points[0]);
    let picked = null;
    let outermost = hit;
    for (let node = hit; node && !holds(node, target); node = up(node)) {
      outermost = node;
      if (!picked && marked(node)) picked = node;
    }
    return picked || outermost;
  }
  const own = styleOf(target);
  if (own.visibility !== 'visible') return { state: 'hidden' };
  if (mode === 'see') {
    for (let node = target; node; node = up(node)) {
      if (node.nodeType === 1 && Number(styleOf(node).opacity) === 0) return { state: 'hidden' };
    }
    return { state: 'clear', index: -1 };
  }
  if (own.pointerEvents === 'none') return { state: 'inert' };
  let covered = -1;
  for (let index = 0; index < points.length; index += 1) {
    const hit = hitAt(points[index]);
    if (hit && holds(target, hit)) return { state: 'clear', index };
    if (hit && covered < 0) covered = index;
  }
  return covered < 0 ? { state: 'offscreen' } : { state: 'covered', index: covered };
}`;

function boundsOf(quad: number[]): Rect {
  const xs = [quad[0]!, quad[2]!, quad[4]!, quad[6]!];
  const ys = [quad[1]!, quad[3]!, quad[5]!, quad[7]!];
  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  };
}

function clip(rect: Rect, view: Rect): Rect | null {
  const left = Math.max(rect.left, view.left);
  const top = Math.max(rect.top, view.top);
  const right = Math.min(rect.right, view.right);
  const bottom = Math.min(rect.bottom, view.bottom);
  return right > left && bottom > top ? { left, top, right, bottom } : null;
}

function candidatePoints(quads: number[][], view: Rect): Point[] {
  const visible = quads
    .filter((quad) => quad.length === 8)
    .map((quad) => clip(boundsOf(quad), view))
    .filter((rect): rect is Rect => rect !== null);
  return visible.flatMap((rect) =>
    SPOTS.map(([across, down]) => ({
      x: rect.left + (rect.right - rect.left) * across,
      y: rect.top + (rect.bottom - rect.top) * down,
    })),
  );
}

async function visibleView(cdp: Cdp): Promise<Rect> {
  const { cssVisualViewport: view } = await cdp.send<{
    cssVisualViewport: {
      offsetX?: number;
      offsetY?: number;
      clientWidth: number;
      clientHeight: number;
    };
  }>('Page.getLayoutMetrics');
  const left = view.offsetX ?? 0;
  const top = view.offsetY ?? 0;
  return { left, top, right: left + view.clientWidth, bottom: top + view.clientHeight };
}

async function contentQuads(cdp: Cdp, node: number): Promise<number[][]> {
  try {
    const { quads } = await cdp.send<{ quads: number[][] }>('DOM.getContentQuads', {
      backendNodeId: node,
    });
    return quads;
  } catch {
    return [];
  }
}

async function isolatedHandle(cdp: Cdp, node: number): Promise<string> {
  const { frameTree } = await cdp.send<{ frameTree: { frame: { id: string } } }>(
    'Page.getFrameTree',
  );
  const { executionContextId } = await cdp.send<{ executionContextId: number }>(
    'Page.createIsolatedWorld',
    { frameId: frameTree.frame.id, worldName: WORLD },
  );
  const resolved = await cdp
    .send<{ object: { objectId?: string } }>('DOM.resolveNode', {
      backendNodeId: node,
      executionContextId,
      objectGroup: GROUP,
    })
    .catch(() => null);
  const objectId = resolved?.object.objectId;
  if (!objectId) throw new PageToolError('no_ref', ACT_NOT_VISIBLE);
  return objectId;
}

async function withHandle<T>(
  cdp: Cdp,
  node: number,
  work: (handle: string) => Promise<T>,
): Promise<T> {
  try {
    return await work(await isolatedHandle(cdp, node));
  } finally {
    await cdp.send('Runtime.releaseObjectGroup', { objectGroup: GROUP }).catch(() => undefined);
  }
}

function asProbe(value: unknown): Probe {
  const probe = value as { state?: unknown; index?: unknown } | null;
  const state = probe?.state;
  if (state === 'clear' || state === 'covered') {
    if (typeof probe?.index === 'number') return { state, index: probe.index };
  }
  if (state === 'hidden' || state === 'inert' || state === 'offscreen') return { state };
  throw new PageToolError('failed', 'Spark could not check what is under that element.');
}

async function probe(cdp: Cdp, handle: string, points: Point[], mode: ProbeMode): Promise<Probe> {
  const { result } = await cdp.send<{ result: { value?: unknown } }>('Runtime.callFunctionOn', {
    objectId: handle,
    functionDeclaration: HIT_PROBE,
    arguments: [{ value: points }, { value: mode }],
    returnByValue: true,
  });
  return asProbe(result.value);
}

async function coverName(
  cdp: Cdp,
  handle: string,
  point: Point,
  filled: ReadonlySet<number>,
): Promise<string> {
  const { result } = await cdp.send<{ result: { objectId?: string } }>('Runtime.callFunctionOn', {
    objectId: handle,
    functionDeclaration: HIT_PROBE,
    arguments: [{ value: [point] }, { value: 'cover' }],
    objectGroup: GROUP,
  });
  if (!result.objectId) return 'another element';
  const { node } = await cdp.send<{ node: { backendNodeId: number } }>('DOM.describeNode', {
    objectId: result.objectId,
  });
  const { role, name } = await describeTarget(cdp, node.backendNodeId, filled);
  return name ? `${role} '${name}'` : `a ${role} element with no name`;
}

async function refusal(
  cdp: Cdp,
  handle: string,
  found: Probe,
  points: Point[],
  context: AimContext,
): Promise<PageToolError> {
  const { label } = context;
  if (found.state === 'hidden') {
    return new PageToolError(
      'failed',
      `${label} is hidden or fully transparent, so a person could not see it. Spark does not act on it.`,
    );
  }
  if (found.state === 'inert') {
    return new PageToolError(
      'failed',
      `${label} does not take clicks (pointer-events: none). Act on the element that does.`,
    );
  }
  if (found.state === 'covered') {
    const cover = await coverName(cdp, handle, points[found.index]!, context.filled);
    return new PageToolError(
      'failed',
      `${label} is covered by ${cover}. Close or act on that first.`,
    );
  }
  return new PageToolError('no_ref', ACT_NOT_VISIBLE);
}

async function visiblePoints(cdp: Cdp, node: number): Promise<Point[]> {
  const points = candidatePoints(await contentQuads(cdp, node), await visibleView(cdp));
  if (points.length === 0) throw new PageToolError('no_ref', ACT_NOT_VISIBLE);
  return points;
}

export async function aimAt(cdp: Cdp, node: number, context: AimContext): Promise<Point> {
  const points = await visiblePoints(cdp, node);
  return withHandle(cdp, node, async (handle) => {
    const found = await probe(cdp, handle, points, 'aim');
    if (found.state === 'clear') return points[found.index]!;
    throw await refusal(cdp, handle, found, points, context);
  });
}

export async function stillClear(
  cdp: Cdp,
  node: number,
  point: Point,
  context: AimContext,
): Promise<void> {
  await withHandle(cdp, node, async (handle) => {
    const found = await probe(cdp, handle, [point], 'aim');
    if (found.state !== 'clear') throw await refusal(cdp, handle, found, [point], context);
  });
}

export async function mustBeSeen(cdp: Cdp, node: number, context: AimContext): Promise<void> {
  await visiblePoints(cdp, node);
  await withHandle(cdp, node, async (handle) => {
    const found = await probe(cdp, handle, [], 'see');
    if (found.state !== 'clear') throw await refusal(cdp, handle, found, [], context);
  });
}
