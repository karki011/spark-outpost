import type { KeyboardEvent, PointerEvent } from 'react';
import { clampPanelWidth, type PanelWidthLimits } from './panel-width.ts';
import { holdTransitions, releaseAfterPaint, startWidthDrag, widthText } from './width-drag.ts';

const STEP = 16;
const BIG_STEP = 48;

export interface PanelResizerProps {
  className: string;
  label: string;
  panelSelector: string;
  variable: string;
  cap: string;
  side: 'left' | 'right';
  limits: PanelWidthLimits;
  width: number | null;
  onWidth(width: number | null): void;
  targets?: (panel: HTMLElement) => HTMLElement[];
}

export function PanelResizer(props: PanelResizerProps) {
  const { limits, onWidth } = props;
  const width = props.width ?? limits.fallback;
  const grow = props.side === 'left' ? 'ArrowLeft' : 'ArrowRight';
  const shrink = props.side === 'left' ? 'ArrowRight' : 'ArrowLeft';

  const resize = (handle: HTMLElement, next: number | null) => {
    const release = holdTransitions(handle.closest(props.panelSelector));
    onWidth(next);
    releaseAfterPaint(release);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const panel = event.currentTarget.closest<HTMLElement>(props.panelSelector);
    startWidthDrag(event, {
      panel,
      host: panel,
      variable: props.variable,
      targets: panel ? (props.targets?.(panel) ?? [panel]) : [],
      cap: props.cap,
      startWidth: panel?.getBoundingClientRect().width ?? width,
      direction: props.side === 'left' ? -1 : 1,
      clamp: (next) => clampPanelWidth(next, limits),
      commit: onWidth,
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? BIG_STEP : STEP;
    const next: Record<string, number | null> = {
      [grow]: width + step,
      [shrink]: width - step,
      Home: limits.min,
      End: limits.max,
      Enter: null,
    };
    if (!(event.key in next)) return;
    event.preventDefault();
    event.stopPropagation();
    resize(event.currentTarget, next[event.key] ?? null);
  };

  return (
    <div
      className={props.className}
      role="separator"
      aria-orientation="vertical"
      aria-label={props.label}
      aria-valuemin={limits.min}
      aria-valuemax={limits.max}
      aria-valuenow={width}
      aria-valuetext={widthText(width)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={(event) => resize(event.currentTarget, null)}
      onKeyDown={onKeyDown}
    />
  );
}
