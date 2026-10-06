import { useLayoutEffect, type RefObject } from 'react';

export const VIEWPORT_MARGIN = 8;

export function clampStart(
  start: number,
  size: number,
  limit: number,
  margin = VIEWPORT_MARGIN,
): number {
  return Math.max(margin, Math.min(start, limit - size - margin));
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

function layoutBox(element: HTMLElement): Box {
  const parent = element.offsetParent;
  const size = { width: element.offsetWidth, height: element.offsetHeight };
  if (!(parent instanceof HTMLElement)) {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, top: rect.top, ...size };
  }
  const origin = parent.getBoundingClientRect();
  return {
    left: origin.left + parent.clientLeft + element.offsetLeft - parent.scrollLeft,
    top: origin.top + parent.clientTop + element.offsetTop - parent.scrollTop,
    ...size,
  };
}

function usableBottom(): number {
  const bar = document.querySelector('[data-bottom-bar]');
  return bar ? bar.getBoundingClientRect().top : window.innerHeight;
}

export function keepInViewport(element: HTMLElement): void {
  element.style.translate = '';
  element.style.maxHeight = '';
  const bottom = usableBottom();
  const room = bottom - VIEWPORT_MARGIN * 2;
  if (element.offsetHeight > room) element.style.maxHeight = `${room}px`;
  const box = layoutBox(element);
  const dx = Math.round(clampStart(box.left, box.width, window.innerWidth) - box.left);
  const dy = Math.round(clampStart(box.top, box.height, bottom) - box.top);
  if (dx !== 0 || dy !== 0) element.style.translate = `${dx}px ${dy}px`;
}

export function useKeepInViewport(ref: RefObject<HTMLElement | null>, open: boolean): void {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!open || !element) return;
    const place = () => keepInViewport(element);
    place();
    window.addEventListener('resize', place);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : null;
    observer?.observe(element);
    return () => {
      window.removeEventListener('resize', place);
      observer?.disconnect();
    };
  }, [ref, open]);
}
