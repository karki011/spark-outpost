import type { KeyboardEvent, PointerEvent } from 'react';
import { clampDrawerWidth, DRAWER_MIN_WIDTH, drawerMaxWidth } from './drawer-prefs.ts';

const STEP = 24;
const BIG_STEP = 96;

interface DrawerResizerProps {
  width: number;
  onWidth(width: number | null): void;
}

export function DrawerResizer({ width, onWidth }: DrawerResizerProps) {
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const drawer = handle.closest<HTMLElement>('.dd');
    const startWidth = drawer?.getBoundingClientRect().width ?? width;
    const startX = event.clientX;
    let next = startWidth;
    let frame = 0;
    handle.setPointerCapture(event.pointerId);
    drawer?.classList.add('resizing');
    const onMove = (move: globalThis.PointerEvent) => {
      next = clampDrawerWidth(startWidth - (move.clientX - startX));
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        drawer?.style.setProperty('--dd-w', `${next}px`);
      });
    };
    const onUp = () => {
      cancelAnimationFrame(frame);
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      drawer?.classList.remove('resizing');
      onWidth(next);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? BIG_STEP : STEP;
    const next: Record<string, number | null> = {
      ArrowLeft: width + step,
      ArrowRight: width - step,
      Home: DRAWER_MIN_WIDTH,
      End: drawerMaxWidth(),
      Enter: null,
    };
    if (!(event.key in next)) return;
    event.preventDefault();
    event.stopPropagation();
    onWidth(next[event.key] ?? null);
  };

  return (
    <div
      className="dd-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize changes drawer"
      aria-valuemin={DRAWER_MIN_WIDTH}
      aria-valuemax={drawerMaxWidth()}
      aria-valuenow={width}
      aria-valuetext={`${width} pixels wide. Arrow keys resize, Enter resets.`}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={() => onWidth(null)}
      onKeyDown={onKeyDown}
    />
  );
}
