import type { BrowserBox } from '@spark-outpost/contracts';

export type PickMode = 'element' | 'region';

export interface PickPointer {
  type: 'down' | 'move' | 'up';
  x: number;
  y: number;
  shift: boolean;
}

export type GestureAction =
  | { kind: 'hover'; x: number; y: number }
  | { kind: 'click'; x: number; y: number; keep: boolean }
  | { kind: 'band'; box: BrowserBox }
  | { kind: 'region'; box: BrowserBox; keep: boolean }
  | { kind: 'none' };

export interface GestureState {
  startX: number;
  startY: number;
  dragging: boolean;
}

const DRAG_PIXELS = 6;

function bandBetween(state: GestureState, pointer: PickPointer): BrowserBox {
  return {
    x: Math.min(state.startX, pointer.x),
    y: Math.min(state.startY, pointer.y),
    width: Math.abs(pointer.x - state.startX),
    height: Math.abs(pointer.y - state.startY),
  };
}

function movedFarEnough(state: GestureState, pointer: PickPointer): boolean {
  return (
    Math.abs(pointer.x - state.startX) >= DRAG_PIXELS ||
    Math.abs(pointer.y - state.startY) >= DRAG_PIXELS
  );
}

export function stepGesture(
  state: GestureState | null,
  mode: PickMode,
  pointer: PickPointer,
): { state: GestureState | null; action: GestureAction } {
  if (pointer.type === 'down') {
    return {
      state: { startX: pointer.x, startY: pointer.y, dragging: false },
      action: { kind: 'none' },
    };
  }
  if (pointer.type === 'move') {
    if (!state) {
      const action: GestureAction =
        mode === 'element' ? { kind: 'hover', x: pointer.x, y: pointer.y } : { kind: 'none' };
      return { state, action };
    }
    if (!state.dragging && !movedFarEnough(state, pointer))
      return { state, action: { kind: 'none' } };
    return {
      state: { ...state, dragging: true },
      action: { kind: 'band', box: bandBetween(state, pointer) },
    };
  }
  if (!state) return { state: null, action: { kind: 'none' } };
  if (state.dragging) {
    return {
      state: null,
      action: { kind: 'region', box: bandBetween(state, pointer), keep: pointer.shift },
    };
  }
  if (mode === 'region') return { state: null, action: { kind: 'none' } };
  return {
    state: null,
    action: { kind: 'click', x: pointer.x, y: pointer.y, keep: pointer.shift },
  };
}

export interface TreeNode {
  backendNodeId: number;
  nodeName: string;
  children?: TreeNode[];
  shadowRoots?: TreeNode[];
  contentDocument?: TreeNode;
}

function isElement(node: TreeNode): boolean {
  return !node.nodeName.startsWith('#');
}

export function parentElementOf(root: TreeNode, backendNodeId: number): number | null {
  const walk = (node: TreeNode, nearest: number | null): number | null | undefined => {
    if (node.backendNodeId === backendNodeId) return nearest;
    const next = isElement(node) ? node.backendNodeId : nearest;
    const kids = [
      ...(node.shadowRoots ?? []),
      ...(node.contentDocument ? [node.contentDocument] : []),
      ...(node.children ?? []),
    ];
    for (const kid of kids) {
      const found = walk(kid, next);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  return walk(root, null) ?? null;
}

export function latestOnly<T>(run: (value: T) => Promise<void>): (value: T) => void {
  let busy = false;
  let waiting: { value: T } | null = null;
  const pump = async (value: T) => {
    busy = true;
    await run(value).catch(() => undefined);
    busy = false;
    if (!waiting) return;
    const next = waiting.value;
    waiting = null;
    void pump(next);
  };
  return (value) => {
    if (busy) waiting = { value };
    else void pump(value);
  };
}
