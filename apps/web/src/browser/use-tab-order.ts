import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { changesOrder, dropBefore, keyedBefore, movedLine, type TabEdge } from './tab-order.ts';

interface TabOrderOptions {
  ids: readonly string[];
  axis: 'x' | 'y';
  elementId(id: string): string;
  labelOf(id: string): string;
  move(id: string, before: string | null): void;
}

interface Press {
  id: string;
  x: number;
  y: number;
  dragging: boolean;
  before: string | null;
}

const DRAG_START_PX = 4;

function edgesOf(from: Element, axis: 'x' | 'y'): TabEdge[] {
  const items = from.closest('[data-tab-list]')?.querySelectorAll<HTMLElement>('[data-tab-item]');
  return Array.from(items ?? []).map((item) => {
    const box = item.getBoundingClientRect();
    return {
      id: item.dataset.tabItem ?? '',
      start: axis === 'x' ? box.left : box.top,
      end: axis === 'x' ? box.right : box.bottom,
    };
  });
}

export function useTabOrder({ ids, axis, elementId, labelOf, move }: TabOrderOptions) {
  const [drag, setDrag] = useState<{ id: string; before: string | null } | null>(null);
  const [moved, setMoved] = useState('');
  const press = useRef<Press | null>(null);
  const skipClick = useRef(false);
  const refocus = useRef<string | null>(null);
  const order = ids.join(' ');

  useEffect(() => {
    if (!refocus.current) return;
    document.getElementById(elementId(refocus.current))?.focus();
    refocus.current = null;
  }, [order, elementId]);

  useEffect(() => {
    if (!drag) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      press.current = null;
      skipClick.current = true;
      setDrag(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [drag]);

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const current = press.current;
    if (!current) return;
    const far =
      Math.abs(event.clientX - current.x) > DRAG_START_PX ||
      Math.abs(event.clientY - current.y) > DRAG_START_PX;
    if (!current.dragging && !far) return;
    if (!current.dragging) event.currentTarget.setPointerCapture(event.pointerId);
    current.dragging = true;
    const pointer = axis === 'x' ? event.clientX : event.clientY;
    current.before = dropBefore(edgesOf(event.currentTarget, axis), pointer);
    setDrag({ id: current.id, before: current.before });
  };

  const finish = (commit: boolean) => {
    const current = press.current;
    press.current = null;
    if (!current?.dragging) return;
    skipClick.current = true;
    setDrag(null);
    if (commit && changesOrder(ids, current.id, current.before)) move(current.id, current.before);
  };

  const handlers = (id: string) => ({
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      skipClick.current = false;
      press.current = { id, x: event.clientX, y: event.clientY, dragging: false, before: null };
    },
    onPointerMove,
    onPointerUp: () => finish(true),
    onPointerCancel: () => finish(false),
    onClickCapture: (event: { preventDefault(): void; stopPropagation(): void }) => {
      if (!skipClick.current) return;
      skipClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  });

  const keyMove = (event: KeyboardEvent<HTMLElement>, id: string): boolean => {
    const back = axis === 'x' ? 'ArrowLeft' : 'ArrowUp';
    const forward = axis === 'x' ? 'ArrowRight' : 'ArrowDown';
    if (!event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return false;
    if (event.key !== back && event.key !== forward) return false;
    event.preventDefault();
    const delta = event.key === back ? -1 : 1;
    const before = keyedBefore(ids, id, delta);
    if (before === undefined) return true;
    refocus.current = id;
    move(id, before);
    setMoved(movedLine(labelOf(id), ids.indexOf(id) + delta + 1, ids.length));
    return true;
  };

  const dropClass = (id: string): string => {
    if (!drag || !changesOrder(ids, drag.id, drag.before)) return drag?.id === id ? 'tab-drag' : '';
    if (drag.id === id) return 'tab-drag';
    if (drag.before === id) return 'tab-drop-before';
    return drag.before === null && ids.at(-1) === id ? 'tab-drop-after' : '';
  };

  return { handlers, keyMove, dropClass, moved };
}
