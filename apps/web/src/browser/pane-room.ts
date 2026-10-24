import { useLayoutEffect, useState, type RefObject } from 'react';
import { dockedRoom, overlayRoom, paneRange, type PaneRange } from './pane-width.ts';

const PANE_EDGE = 8;
const OVERLAY_GAPS = 16;
const CAP = '--wp-cap';

export interface PaneMeasure {
  range: PaneRange;
  inset: number;
}

function pageInset(panel: HTMLElement): number {
  const inner = panel.querySelector<HTMLElement>(':scope > .wp-in');
  const page = panel.querySelector<HTMLElement>('#bp-view');
  if (!inner || !page) return 0;
  return Math.round(inner.getBoundingClientRect().width - page.getBoundingClientRect().width);
}

function room(panel: HTMLElement): number {
  const chat = panel.parentElement?.querySelector<HTMLElement>(':scope > .main');
  if (panel.classList.contains('over') || !chat || !panel.parentElement) {
    return overlayRoom(window.innerWidth, OVERLAY_GAPS);
  }
  const chatGap = parseFloat(getComputedStyle(chat).marginRight) || 0;
  return dockedRoom({
    rowRight: panel.parentElement.getBoundingClientRect().right - PANE_EDGE,
    chatLeft: chat.getBoundingClientRect().left,
    gaps: chatGap,
  });
}

export function measurePane(panel: HTMLElement): PaneMeasure {
  const inset = pageInset(panel);
  return { range: paneRange(room(panel), inset), inset };
}

function same(a: PaneMeasure, b: PaneMeasure): boolean {
  return a.inset === b.inset && a.range.min === b.range.min && a.range.max === b.range.max;
}

export function usePaneRoom(handle: RefObject<HTMLElement | null>, initial: PaneMeasure) {
  const [measure, setMeasure] = useState(initial);
  useLayoutEffect(() => {
    const panel = handle.current?.closest<HTMLElement>('.wp');
    if (!panel) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const next = measurePane(panel);
      panel.style.setProperty(CAP, `${next.range.max}px`);
      setMeasure((current) => (same(current, next) ? current : next));
    };
    const schedule = () => {
      frame ||= requestAnimationFrame(update);
    };
    update();
    const observer = new ResizeObserver(schedule);
    if (panel.parentElement) observer.observe(panel.parentElement);
    const chat = panel.parentElement?.querySelector(':scope > .main');
    if (chat) observer.observe(chat);
    const page = panel.querySelector('#bp-view');
    if (page) observer.observe(page);
    window.addEventListener('resize', schedule);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      cancelAnimationFrame(frame);
      panel.style.removeProperty(CAP);
    };
  }, [handle]);
  return measure;
}
