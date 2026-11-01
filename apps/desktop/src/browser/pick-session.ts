import type { BrowserBox } from '@spark-outpost/contracts';
import type { Cdp } from './cdp.ts';
import { boxOf } from './page-read.ts';
import {
  latestOnly,
  parentElementOf,
  stepGesture,
  type GestureState,
  type PickMode,
  type TreeNode,
} from './pick-gesture.ts';
import type { PickSurface } from './pick-overlay.ts';
import { pageScroll, pickedElement, pickedRegion, type PickFacts } from './picker.ts';

const TAG_MAX = 40;

export interface PickSession {
  cancel(): Promise<void>;
}

export interface PickCallbacks {
  picked(facts: PickFacts): void;
  ended(): void;
}

function scaled(box: BrowserBox, by: number): BrowserBox {
  return { x: box.x * by, y: box.y * by, width: box.width * by, height: box.height * by };
}

function labelOf(tag: string, box: BrowserBox): string {
  const name = tag.toLowerCase().slice(0, TAG_MAX);
  return `${name} · ${Math.round(box.width)} × ${Math.round(box.height)}`;
}

export async function startPick(
  cdp: Cdp,
  surface: PickSurface,
  mode: PickMode,
  callbacks: PickCallbacks,
  filled: ReadonlySet<number> = new Set(),
): Promise<PickSession> {
  let ended = false;
  let gathering = false;
  let gesture: GestureState | null = null;
  let current: { id: number; box: BrowserBox } | null = null;
  let lastPoint: { x: number; y: number } | null = null;
  const below: number[] = [];

  const leave = async () => {
    if (ended) return;
    ended = true;
    surface.close();
    if (mode === 'element') await cdp.send('CSS.disable').catch(() => undefined);
    callbacks.ended();
  };

  const show = async (id: number) => {
    const box = await boxOf(cdp, id);
    if (ended || !box) return false;
    const { node } = await cdp.send<{ node: { nodeName: string } }>('DOM.describeNode', {
      backendNodeId: id,
    });
    if (ended) return false;
    current = { id, box };
    surface.draw(scaled(box, surface.zoom()), labelOf(node.nodeName, box));
    return true;
  };

  const hover = latestOnly(async (point: { x: number; y: number }) => {
    if (ended || gathering) return;
    const zoom = surface.zoom();
    const scroll = await pageScroll(cdp);
    const hit = await cdp
      .send<{ backendNodeId: number }>('DOM.getNodeForLocation', {
        x: Math.round(scroll.x + point.x / zoom),
        y: Math.round(scroll.y + point.y / zoom),
        ignorePointerEventsNone: true,
      })
      .catch(() => null);
    if (!hit) {
      current = null;
      surface.clear();
      return;
    }
    if (hit.backendNodeId === current?.id) return;
    below.length = 0;
    await show(hit.backendNodeId);
  });

  const gather = async (read: () => Promise<PickFacts | null>, keep: boolean) => {
    gathering = true;
    surface.busy();
    const facts = await read().catch(() => null);
    gathering = false;
    if (ended) return;
    if (facts) callbacks.picked(facts);
    if (!keep) {
      await leave();
      return;
    }
    if (facts) surface.mark(scaled(facts.box, surface.zoom()));
    surface.clear();
    current = null;
  };

  const chooseCurrent = (keep: boolean) => {
    const chosen = current;
    if (!chosen || gathering) return;
    void gather(() => pickedElement(cdp, chosen.id, filled), keep);
  };

  const toParent = latestOnly(async () => {
    if (!current) return;
    const { root } = await cdp.send<{ root: TreeNode }>('DOM.getDocument', {
      depth: -1,
      pierce: true,
    });
    const parent = parentElementOf(root, current.id);
    if (parent === null) return;
    const from = current.id;
    if (await show(parent)) below.push(from);
  });

  surface.onPointer((pointer) => {
    if (ended) return;
    if (pointer.type === 'move') lastPoint = { x: pointer.x, y: pointer.y };
    const step = stepGesture(gesture, mode, pointer);
    gesture = step.state;
    const { action } = step;
    if (action.kind === 'hover') hover({ x: action.x, y: action.y });
    if (action.kind === 'band') surface.band(action.box);
    if (action.kind === 'click') chooseCurrent(action.keep);
    if (action.kind === 'region') {
      surface.unband();
      if (gathering) return;
      const box = scaled(action.box, 1 / surface.zoom());
      if (box.width >= 1 && box.height >= 1) {
        void gather(() => pickedRegion(cdp, box, filled), action.keep);
      }
    }
  });

  surface.onKey(({ key, shift }) => {
    if (key === 'Escape') void leave();
    if (mode !== 'element') return;
    if (key === 'Enter') chooseCurrent(shift);
    if (key === 'ArrowUp') toParent(undefined);
    if (key === 'ArrowDown') {
      const next = below.pop();
      if (next !== undefined) void show(next).catch(() => undefined);
    }
  });

  surface.onWheel((wheel) => {
    if (ended) return;
    surface.unmark();
    const zoom = surface.zoom();
    void cdp
      .send('Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x: wheel.x / zoom,
        y: wheel.y / zoom,
        deltaX: wheel.deltaX,
        deltaY: wheel.deltaY,
      })
      .then(() => {
        current = null;
        if (lastPoint && mode === 'element') hover(lastPoint);
      })
      .catch(() => undefined);
  });

  surface.onGone(() => void leave());

  await cdp.send('DOM.enable');
  if (mode === 'element') await cdp.send('CSS.enable');
  return { cancel: leave };
}
