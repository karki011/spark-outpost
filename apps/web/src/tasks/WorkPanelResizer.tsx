import type { KeyboardEvent, PointerEvent } from 'react';
import {
  WORK_PANEL_DEFAULT_WIDTH,
  WORK_PANEL_MAX_WIDTH,
  WORK_PANEL_MIN_WIDTH,
} from './work-panel-state.ts';

const STEP = 16;
const BIG_STEP = 48;

function holdTransitions(): () => void {
  const app = document.querySelector('.app');
  const panel = document.getElementById('work-panel');
  app?.classList.add('resizing');
  panel?.classList.add('dragging');
  return () => {
    app?.classList.remove('resizing');
    panel?.classList.remove('dragging');
  };
}

function releaseAfterPaint(release: () => void): void {
  requestAnimationFrame(() => requestAnimationFrame(release));
}

interface WorkPanelResizerProps {
  width: number | null;
  onWidth(width: number | null): void;
}

export function WorkPanelResizer({ width: saved, onWidth }: WorkPanelResizerProps) {
  const width = saved ?? WORK_PANEL_DEFAULT_WIDTH;

  const resize = (next: number | null) => {
    const release = holdTransitions();
    onWidth(next);
    releaseAfterPaint(release);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const panel = handle.closest('.wp');
    const startWidth = panel?.getBoundingClientRect().width ?? width;
    const startX = event.clientX;
    const release = holdTransitions();
    handle.setPointerCapture(event.pointerId);
    const onMove = (move: globalThis.PointerEvent) => {
      onWidth(startWidth - (move.clientX - startX));
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
      ArrowLeft: width + step,
      ArrowRight: width - step,
      Home: WORK_PANEL_MIN_WIDTH,
      End: WORK_PANEL_MAX_WIDTH,
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
      aria-valuemin={WORK_PANEL_MIN_WIDTH}
      aria-valuemax={WORK_PANEL_MAX_WIDTH}
      aria-valuenow={width}
      aria-valuetext={`${width} pixels wide. Arrow keys resize, Enter resets.`}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={() => resize(null)}
      onKeyDown={onKeyDown}
    />
  );
}
