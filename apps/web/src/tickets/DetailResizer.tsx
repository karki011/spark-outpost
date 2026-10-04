import type { KeyboardEvent, PointerEvent } from 'react';
import { holdTransitions, releaseAfterPaint, startWidthDrag, widthText } from '../ui/width-drag.ts';
import {
  clampDetailWidth,
  DETAIL_DEFAULT_WIDTH,
  DETAIL_MAX_WIDTH,
  DETAIL_MIN_WIDTH,
} from './detail-width.ts';

const STEP = 16;
const BIG_STEP = 48;

interface DetailResizerProps {
  width: number | null;
  onWidth: (width: number | null) => void;
}

export function DetailResizer({ width: saved, onWidth }: DetailResizerProps) {
  const width = saved ?? DETAIL_DEFAULT_WIDTH;

  const resize = (handle: HTMLElement, next: number | null) => {
    const release = holdTransitions(handle.closest('.tk-detail'));
    onWidth(next);
    releaseAfterPaint(release);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const panel = event.currentTarget.closest<HTMLElement>('.tk-detail');
    startWidthDrag(event, {
      panel,
      host: panel,
      variable: '--tk-detail-w',
      targets: panel ? [panel] : [],
      cap: '--tk-detail-cap',
      startWidth: panel?.getBoundingClientRect().width ?? width,
      direction: -1,
      clamp: clampDetailWidth,
      commit: onWidth,
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? BIG_STEP : STEP;
    const next: Record<string, number | null> = {
      ArrowLeft: width + step,
      ArrowRight: width - step,
      Home: DETAIL_MIN_WIDTH,
      End: DETAIL_MAX_WIDTH,
      Enter: null,
    };
    if (!(event.key in next)) return;
    event.preventDefault();
    event.stopPropagation();
    resize(event.currentTarget, next[event.key] ?? null);
  };

  return (
    <div
      className="tk-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize ticket details"
      aria-valuemin={DETAIL_MIN_WIDTH}
      aria-valuemax={DETAIL_MAX_WIDTH}
      aria-valuenow={width}
      aria-valuetext={widthText(width)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={(event) => resize(event.currentTarget, null)}
      onKeyDown={onKeyDown}
    />
  );
}
