import type { KeyboardEvent, PointerEvent } from 'react';
import { holdTransitions, releaseAfterPaint, startWidthDrag, widthText } from '../ui/width-drag.ts';
import {
  clampWidth,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  useSidebarLayout,
} from './sidebar-layout.tsx';

const STEP = 16;
const BIG_STEP = 48;

export function SidebarResizer() {
  const layout = useSidebarLayout();
  if (!layout || layout.narrow || layout.collapsed) return null;
  const { setWidth } = layout;
  const width = layout.width ?? SIDEBAR_DEFAULT_WIDTH;

  const resize = (next: number | null) => {
    const release = holdTransitions(document.querySelector('.side'));
    setWidth(next);
    releaseAfterPaint(release);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const side = event.currentTarget.closest<HTMLElement>('.side');
    startWidthDrag(event, {
      panel: side,
      host: event.currentTarget.closest<HTMLElement>('.app'),
      variable: '--side-w',
      targets: side ? [side, ...side.querySelectorAll<HTMLElement>(':scope > .side-in')] : [],
      cap: '--side-cap',
      startWidth: side?.getBoundingClientRect().width ?? width,
      direction: 1,
      clamp: clampWidth,
      commit: setWidth,
    });
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
      aria-valuetext={widthText(width)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={() => resize(null)}
      onKeyDown={onKeyDown}
    />
  );
}
