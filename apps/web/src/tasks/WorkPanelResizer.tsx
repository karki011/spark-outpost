import type { KeyboardEvent, PointerEvent } from 'react';
import { holdTransitions, releaseAfterPaint, startWidthDrag, widthText } from '../ui/width-drag.ts';
import { clampPanelWidth, WORK_PANEL_LIMITS, type PanelWidthLimits } from './work-panel-state.ts';

const STEP = 16;
const BIG_STEP = 48;

interface WorkPanelResizerProps {
  width: number | null;
  onWidth(width: number | null): void;
  limits?: PanelWidthLimits;
}

export function WorkPanelResizer({
  width: saved,
  onWidth,
  limits = WORK_PANEL_LIMITS,
}: WorkPanelResizerProps) {
  const width = saved ?? limits.fallback;

  const resize = (next: number | null) => {
    const release = holdTransitions(document.getElementById('work-panel'));
    onWidth(next);
    releaseAfterPaint(release);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const panel = event.currentTarget.closest<HTMLElement>('.wp');
    startWidthDrag(event, {
      panel,
      host: panel,
      variable: '--wp-w',
      targets: panel ? [panel, ...panel.querySelectorAll<HTMLElement>(':scope > .wp-in')] : [],
      cap: '--wp-cap',
      startWidth: panel?.getBoundingClientRect().width ?? width,
      direction: -1,
      clamp: (next) => clampPanelWidth(next, limits),
      commit: onWidth,
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? BIG_STEP : STEP;
    const next: Record<string, number | null> = {
      ArrowLeft: width + step,
      ArrowRight: width - step,
      Home: limits.min,
      End: limits.max,
      Enter: null,
    };
    if (!(event.key in next)) return;
    event.preventDefault();
    event.stopPropagation();
    resize(next[event.key] ?? null);
  };

  return (
    <div
      className="wp-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize work panel"
      aria-valuemin={limits.min}
      aria-valuemax={limits.max}
      aria-valuenow={width}
      aria-valuetext={widthText(width)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={() => resize(null)}
      onKeyDown={onKeyDown}
    />
  );
}
