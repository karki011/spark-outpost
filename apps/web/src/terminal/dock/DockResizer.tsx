import type { KeyboardEvent, PointerEvent } from 'react';
import {
  clampDockHeight,
  DOCK_DEFAULT_HEIGHT,
  DOCK_MAX_HEIGHT,
  DOCK_MIN_HEIGHT,
} from './dock-height.ts';

const STEP = 16;
const BIG_STEP = 64;
const THREAD_ROOM = 160;

interface DockResizerProps {
  height: number;
  onHeight(height: number): void;
}

function roomAbove(handle: HTMLElement): number {
  const main = handle.closest('.main');
  return main ? main.getBoundingClientRect().height - THREAD_ROOM : DOCK_MAX_HEIGHT;
}

export function DockResizer({ height, onHeight }: DockResizerProps) {
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const dock = handle.closest<HTMLElement>('.term-dock');
    const startHeight = dock?.getBoundingClientRect().height ?? height;
    const startY = event.clientY;
    const max = roomAbove(handle);
    dock?.classList.add('dragging');
    handle.setPointerCapture(event.pointerId);
    let dragged = clampDockHeight(startHeight, max);
    let frame = 0;
    let moved = false;
    const paint = () => {
      frame = 0;
      dock?.style.setProperty('--term-h', `${dragged}px`);
    };
    const onMove = (move: globalThis.PointerEvent) => {
      moved = true;
      dragged = clampDockHeight(startHeight - (move.clientY - startY), max);
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      if (frame) cancelAnimationFrame(frame);
      dock?.classList.remove('dragging');
      if (moved) {
        paint();
        onHeight(dragged);
      }
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? BIG_STEP : STEP;
    const next: Record<string, number> = {
      ArrowUp: height + step,
      ArrowDown: height - step,
      Home: DOCK_MIN_HEIGHT,
      End: DOCK_MAX_HEIGHT,
      Enter: DOCK_DEFAULT_HEIGHT,
    };
    const target = next[event.key];
    if (target === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    onHeight(clampDockHeight(target, roomAbove(event.currentTarget)));
  };

  return (
    <div
      className="term-resize"
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize terminal"
      aria-valuemin={DOCK_MIN_HEIGHT}
      aria-valuemax={DOCK_MAX_HEIGHT}
      aria-valuenow={height}
      aria-valuetext={`${height} pixels tall. Arrow keys resize, Enter resets.`}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={() => onHeight(DOCK_DEFAULT_HEIGHT)}
      onKeyDown={onKeyDown}
    />
  );
}
