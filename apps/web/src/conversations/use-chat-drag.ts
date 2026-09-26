import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';

export const NO_PROJECT = 'none';

const MOUSE_SLOP = 5;
const TOUCH_SLOP = 8;
const HOLD_MS = 450;
const EDGE = 36;
const SCROLL_STEP = 10;

export interface DragState {
  chatId: string;
  title: string;
  x: number;
  y: number;
  over: string | null;
}

export interface Point {
  x: number;
  y: number;
}

interface ChatDragOptions {
  listRef: RefObject<HTMLElement | null>;
  onDrop: (chatId: string, target: string) => void;
  onHold: (chatId: string, point: Point) => void;
}

type Phase = 'pending' | 'armed' | 'dragging';

function dropTargetAt(x: number, y: number): string | null {
  const element = document.elementFromPoint(x, y);
  return element?.closest<HTMLElement>('[data-drop]')?.dataset.drop ?? null;
}

export function useChatDrag({ listRef, onDrop, onHold }: ChatDragOptions) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const suppressClick = useRef(false);
  const stop = useRef<(() => void) | null>(null);
  const callbacks = useRef({ onDrop, onHold });

  useEffect(() => {
    callbacks.current = { onDrop, onHold };
  });

  useEffect(() => () => stop.current?.(), []);

  const autoScroll = (y: number) => {
    const list = listRef.current;
    if (!list) return;
    const rect = list.getBoundingClientRect();
    if (y < rect.top + EDGE) list.scrollTop -= SCROLL_STEP;
    else if (y > rect.bottom - EDGE) list.scrollTop += SCROLL_STEP;
  };

  const start = (event: PointerEvent<HTMLElement>, chatId: string, title: string) => {
    if (event.button !== 0 || !event.isPrimary) return;
    if ((event.target as HTMLElement).closest('input, .rmenu, .ract')) return;
    stop.current?.();
    const touch = event.pointerType !== 'mouse';
    const origin = { x: event.clientX, y: event.clientY };
    let phase: Phase = 'pending';
    let over: string | null = null;
    const hold = touch
      ? setTimeout(() => {
          phase = 'armed';
          navigator.vibrate?.(8);
        }, HOLD_MS)
      : undefined;

    const begin = (point: Point) => {
      phase = 'dragging';
      over = dropTargetAt(point.x, point.y);
      setDrag({ chatId, title, ...point, over });
    };

    const onMove = (move: globalThis.PointerEvent) => {
      if (move.pointerId !== event.pointerId) return;
      const point = { x: move.clientX, y: move.clientY };
      const distance = Math.hypot(point.x - origin.x, point.y - origin.y);
      if (phase === 'pending') {
        if (!touch && distance > MOUSE_SLOP) begin(point);
        else if (touch && distance > TOUCH_SLOP) cleanup();
        return;
      }
      if (phase === 'armed') {
        if (distance > MOUSE_SLOP) begin(point);
        return;
      }
      over = dropTargetAt(point.x, point.y);
      autoScroll(point.y);
      setDrag({ chatId, title, ...point, over });
    };

    const onUp = (up: globalThis.PointerEvent) => {
      if (up.pointerId !== event.pointerId) return;
      if (phase === 'dragging') {
        suppressClick.current = true;
        if (over) callbacks.current.onDrop(chatId, over);
      } else if (phase === 'armed') {
        suppressClick.current = true;
        callbacks.current.onHold(chatId, { x: up.clientX, y: up.clientY });
      }
      setTimeout(() => {
        suppressClick.current = false;
      }, 0);
      cleanup();
    };

    const onTouchMove = (touchMove: TouchEvent) => {
      if (phase !== 'pending' && touchMove.cancelable) touchMove.preventDefault();
    };

    const onKey = (key: KeyboardEvent) => {
      if (key.key === 'Escape') cleanup();
    };

    const onCancel = () => cleanup();

    function cleanup() {
      clearTimeout(hold);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('keydown', onKey);
      stop.current = null;
      setDrag(null);
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('keydown', onKey);
    stop.current = cleanup;
  };

  const consumeClick = (): boolean => {
    if (!suppressClick.current) return false;
    suppressClick.current = false;
    return true;
  };

  return { drag, start, consumeClick };
}
