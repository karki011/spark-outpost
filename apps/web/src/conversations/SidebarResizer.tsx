import type { KeyboardEvent, PointerEvent } from 'react';
import {
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  useSidebarLayout,
} from './sidebar-layout.tsx';

const STEP = 16;
const BIG_STEP = 48;

function holdTransitions(): () => void {
  const app = document.querySelector('.app');
  const side = document.querySelector('.side');
  app?.classList.add('resizing');
  side?.classList.add('dragging');
  return () => {
    app?.classList.remove('resizing');
    side?.classList.remove('dragging');
  };
}

function releaseAfterPaint(release: () => void): void {
  requestAnimationFrame(() => requestAnimationFrame(release));
}

export function SidebarResizer() {
  const layout = useSidebarLayout();
  if (!layout || layout.narrow || layout.collapsed) return null;
  const { setWidth } = layout;
  const width = layout.width ?? SIDEBAR_DEFAULT_WIDTH;

  const resize = (next: number | null) => {
    const release = holdTransitions();
    setWidth(next);
    releaseAfterPaint(release);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const side = handle.closest('.side');
    const startWidth = side?.getBoundingClientRect().width ?? width;
    const startX = event.clientX;
    const release = holdTransitions();
    handle.setPointerCapture(event.pointerId);
    const onMove = (move: globalThis.PointerEvent) => {
      setWidth(startWidth + move.clientX - startX);
    };
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      release();
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? BIG_STEP : STEP;
    const next: Record<string, number | null> = {
      ArrowLeft: width - step,
      ArrowRight: width + step,
      Home: SIDEBAR_MIN_WIDTH,
      End: SIDEBAR_MAX_WIDTH,
      Enter: null,
    };
    if (!(event.key in next)) return;
    event.preventDefault();
    resize(next[event.key] ?? null);
  };

  return (
    <div
      className="side-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuemin={SIDEBAR_MIN_WIDTH}
      aria-valuemax={SIDEBAR_MAX_WIDTH}
      aria-valuenow={width}
      aria-valuetext={`${width} pixels wide. Arrow keys resize, Enter resets.`}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={() => resize(null)}
      onKeyDown={onKeyDown}
    />
  );
}
