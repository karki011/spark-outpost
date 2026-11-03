import { useLayoutEffect, useState, type RefObject } from 'react';
import { desktopBrowser } from '../desktop/desktop-bridge.ts';
import { dockedRoom, overlayRoom, paneRange, type PaneRange } from './pane-width.ts';
import { layoutParent } from '../ui/layout-parent.ts';

const PANE_EDGE = 8;
const OVERLAY_GAPS = 16;
const CAP = '--wp-cap';

export interface PaneMeasure {
  range: PaneRange;
  inset: number;
  zoom: number;
}

function appZoom(): number {
  const zoom = desktopBrowser()?.zoom?.();
  return zoom !== undefined && Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}

export function pageScale(panel: HTMLElement, zoom: number): number {
  const page = panel.querySelector<HTMLElement>('#bp-view');
  return zoom / (Number(page?.dataset.pageZoom) || 1);
}

function pageInset(panel: HTMLElement): number {
  const inner = panel.querySelector<HTMLElement>(':scope > .wp-in');
  const page = panel.querySelector<HTMLElement>('#bp-view');
  if (!inner || !page) return 0;
  return Math.round(inner.getBoundingClientRect().width - page.getBoundingClientRect().width);
}

function room(panel: HTMLElement): number {
  const chat = panel.parentElement?.querySelector<HTMLElement>(':scope > .main');
  const row = layoutParent(panel);
  if (panel.classList.contains('over') || !chat || !row) {
    return overlayRoom(window.innerWidth, OVERLAY_GAPS);
  }
  const chatGap = parseFloat(getComputedStyle(chat).marginRight) || 0;
  return dockedRoom({
    rowRight: row.getBoundingClientRect().right - PANE_EDGE,
    chatLeft: chat.getBoundingClientRect().left,
    gaps: chatGap,
  });
}

export function measurePane(panel: HTMLElement): PaneMeasure {
  const inset = pageInset(panel);
  const zoom = appZoom();
  return { range: paneRange(room(panel), inset, zoom), inset, zoom };
}

function same(a: PaneMeasure, b: PaneMeasure): boolean {
  return (
    a.inset === b.inset &&
    a.zoom === b.zoom &&
    a.range.min === b.range.min &&
    a.range.max === b.range.max
  );
}

export function usePaneRoom(handle: RefObject<HTMLElement | null>, initial: PaneMeasure) {
  const [measure, setMeasure] = useState(initial);
  useLayoutEffect(() => {
    const panel = handle.current?.closest<HTMLElement>('.wp');
    if (!panel) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      if (panel.getClientRects().length === 0) return;
      const next = measurePane(panel);
      panel.style.setProperty(CAP, `${next.range.max}px`);
      setMeasure((current) => (same(current, next) ? current : next));
    };
    const schedule = () => {
      frame ||= requestAnimationFrame(update);
    };
    update();
    const observer = new ResizeObserver(schedule);
    const row = layoutParent(panel);
    if (row) observer.observe(row);
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
