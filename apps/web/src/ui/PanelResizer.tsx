import type { KeyboardEvent, PointerEvent, Ref } from 'react';
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
  steps?: { step: number; big: number };
  value?: (width: number) => number;
  text?: (width: number) => string;
  onPaint?: (width: number) => void;
  handleRef?: Ref<HTMLDivElement>;
}

export function PanelResizer({ handleRef, ...props }: PanelResizerProps) {
  const { limits, onWidth, steps = { step: STEP, big: BIG_STEP } } = props;
  const value = props.value ?? ((shown: number) => shown);
  const text = props.text ?? widthText;
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
      value,
      text,
      ...(props.onPaint ? { onPaint: props.onPaint } : {}),
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? steps.big : steps.step;
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
      ref={handleRef}
      className={props.className}
      role="separator"
      aria-orientation="vertical"
      aria-label={props.label}
      aria-valuemin={value(limits.min)}
      aria-valuemax={value(limits.max)}
      aria-valuenow={value(width)}
      aria-valuetext={text(width)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={(event) => resize(event.currentTarget, null)}
      onKeyDown={onKeyDown}
    />
  );
}
