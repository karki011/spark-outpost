import './split-divider.css';
import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import {
  SPLIT_RATIO_DEFAULT,
  SPLIT_RATIO_MAX,
  SPLIT_RATIO_MIN,
  clampSplitRatio,
} from '@spark-outpost/contracts';

const STEP = 0.02;
const BIG_STEP = 0.1;

export function percent(ratio: number): number {
  return Math.round(ratio * 100);
}

interface SplitDividerProps {
  ratio: number;
  label: string;
  valueText: string;
  move(ratio: number): void;
  commit(ratio: number): void;
}

export function SplitDivider({ ratio, label, valueText, move, commit }: SplitDividerProps) {
  const frame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const rect = handle.parentElement?.getBoundingClientRect();
    if (!rect) return;
    let latest = ratio;
    const ratioAt = (x: number) => clampSplitRatio((x - rect.left) / rect.width, rect.width);
    const onMove = (next: globalThis.PointerEvent) => {
      latest = ratioAt(next.clientX);
      frame.current ||= requestAnimationFrame(() => {
        frame.current = 0;
        move(latest);
      });
    };
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      commit(latest);
    };
    handle.setPointerCapture(event.pointerId);
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const width = event.currentTarget.parentElement?.getBoundingClientRect().width ?? 0;
    const step = event.shiftKey ? BIG_STEP : STEP;
    const next: Record<string, number> = {
      ArrowLeft: ratio - step,
      ArrowRight: ratio + step,
      Home: SPLIT_RATIO_MIN,
      End: SPLIT_RATIO_MAX,
      Enter: SPLIT_RATIO_DEFAULT,
    };
    const target = next[event.key];
    if (target === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    commit(clampSplitRatio(target, width));
  };

  return (
    <div
      className="split-divider"
      data-live-drag=""
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={percent(SPLIT_RATIO_MIN)}
      aria-valuemax={percent(SPLIT_RATIO_MAX)}
      aria-valuenow={percent(ratio)}
      aria-valuetext={valueText}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={() => commit(SPLIT_RATIO_DEFAULT)}
      onKeyDown={onKeyDown}
    />
  );
}
