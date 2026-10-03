import type { PointerEvent } from 'react';

export function holdTransitions(panel: Element | null): () => void {
  const app = document.querySelector('.app');
  app?.classList.add('resizing');
  panel?.classList.add('dragging');
  return () => {
    app?.classList.remove('resizing');
    panel?.classList.remove('dragging');
  };
}

export function releaseAfterPaint(release: () => void): void {
  requestAnimationFrame(() => requestAnimationFrame(release));
}

export function widthText(width: number): string {
  return `${width} pixels wide. Arrow keys resize, Enter resets.`;
}

interface WidthDrag {
  panel: HTMLElement | null;
  host: HTMLElement | null;
  variable: string;
  targets: readonly HTMLElement[];
  cap: string;
  startWidth: number;
  direction: 1 | -1;
  clamp(width: number): number;
  commit(width: number): void;
}

export function startWidthDrag(event: PointerEvent<HTMLElement>, drag: WidthDrag): void {
  const handle = event.currentTarget;
  const startX = event.clientX;
  const release = holdTransitions(drag.panel);
  let width = drag.clamp(drag.startWidth);
  let frame = 0;
  let moved = false;
  const paint = () => {
    frame = 0;
    for (const target of drag.targets) target.style.width = `min(${width}px, var(${drag.cap}))`;
    handle.setAttribute('aria-valuenow', String(width));
    handle.setAttribute('aria-valuetext', widthText(width));
  };
  const onMove = (move: globalThis.PointerEvent) => {
    moved = true;
    width = drag.clamp(drag.startWidth + drag.direction * (move.clientX - startX));
    if (!frame) frame = requestAnimationFrame(paint);
  };
  const onUp = () => {
    handle.removeEventListener('pointermove', onMove);
    handle.removeEventListener('pointerup', onUp);
    handle.removeEventListener('pointercancel', onUp);
    if (frame) cancelAnimationFrame(frame);
    if (moved) {
      paint();
      drag.host?.style.setProperty(drag.variable, `${width}px`);
      for (const target of drag.targets) target.style.removeProperty('width');
      drag.commit(width);
    }
    releaseAfterPaint(release);
  };
  handle.setPointerCapture(event.pointerId);
  handle.addEventListener('pointermove', onMove);
  handle.addEventListener('pointerup', onUp);
  handle.addEventListener('pointercancel', onUp);
}
