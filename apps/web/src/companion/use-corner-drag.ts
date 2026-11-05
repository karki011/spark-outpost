import { useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { prefersReducedMotion } from '../ui/motion.ts';
import { nearestCorner, type Corner } from './companion-model.ts';

const DRAG_SLOP = 6;
const SNAP_MS = 220;

interface DragStart {
  pointerId: number;
  x: number;
  y: number;
  moved: boolean;
}

export function useCornerDrag(corner: Corner, onCorner: (corner: Corner) => void) {
  const rootRef = useRef<HTMLDivElement>(null);
  const start = useRef<DragStart | null>(null);
  const from = useRef<DOMRect | null>(null);
  const dragged = useRef(false);
  const [dragging, setDragging] = useState(false);

  const settle = () => {
    const root = rootRef.current;
    const origin = from.current;
    from.current = null;
    if (!root || !origin) return;
    root.style.transition = 'none';
    root.style.transform = '';
    if (prefersReducedMotion()) return;
    const target = root.getBoundingClientRect();
    root.style.transform = `translate(${origin.left - target.left}px, ${origin.top - target.top}px)`;
    root.getBoundingClientRect();
    root.style.transition = `transform ${SNAP_MS}ms var(--out)`;
    root.style.transform = '';
    setTimeout(() => {
      root.style.transition = '';
    }, SNAP_MS);
  };

  useLayoutEffect(settle, [corner]);

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    start.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved: false,
    };
    dragged.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = start.current;
    const root = rootRef.current;
    if (!drag || !root || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < DRAG_SLOP) return;
      drag.moved = true;
      root.style.transition = 'none';
      setDragging(true);
    }
    root.style.transform = `translate(${dx}px, ${dy}px)`;
  };

  const onPointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = start.current;
    start.current = null;
    const root = rootRef.current;
    if (!drag?.moved || !root || drag.pointerId !== event.pointerId) return;
    dragged.current = true;
    setDragging(false);
    const rect = root.getBoundingClientRect();
    from.current = rect;
    const next = nearestCorner(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
      innerWidth,
      innerHeight,
    );
    if (next === corner) settle();
    else onCorner(next);
  };

  const moveTo = (next: Corner) => {
    if (next === corner) return;
    from.current = rootRef.current?.getBoundingClientRect() ?? null;
    onCorner(next);
  };

  const consumeDrag = () => {
    const was = dragged.current;
    dragged.current = false;
    return was;
  };

  return {
    rootRef,
    dragging,
    moveTo,
    consumeDrag,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp },
  };
}
