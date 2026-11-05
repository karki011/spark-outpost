import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { chatArea, type Box, type Rect } from './tv-layout.ts';

const COLUMN_SELECTOR = 'main.main .thread-wrap';
const PANEL_ID = 'work-panel';
const PANE_SELECTOR = '#work-panel.on .wp-in';

function subscribeResize(listener: () => void) {
  window.addEventListener('resize', listener);
  return () => window.removeEventListener('resize', listener);
}

function viewportKey(): string {
  return `${innerWidth}x${innerHeight}`;
}

export function useViewport(): Box {
  const key = useSyncExternalStore(subscribeResize, viewportKey);
  const [width, height] = key.split('x').map(Number);
  return { width: width!, height: height! };
}

export function useThrottledText(text: string, delayMs: number): string {
  const latest = useRef(text);
  const [spoken, setSpoken] = useState(text);
  const pending = text !== spoken;

  useEffect(() => {
    latest.current = text;
  });

  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => setSpoken(latest.current), delayMs);
    return () => clearTimeout(timer);
  }, [pending, delayMs]);

  return spoken;
}

function rectOf(element: Element | null): Rect | null {
  if (!element) return null;
  const { left, top, right, bottom } = element.getBoundingClientRect();
  return right > left && bottom > top ? { left, top, right, bottom } : null;
}

function sameRect(a: Rect | null, b: Rect | null): boolean {
  if (!a || !b) return a === b;
  return a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom;
}

function measureChatArea(): Rect | null {
  const column = rectOf(document.querySelector(COLUMN_SELECTOR));
  return column ? chatArea(column, rectOf(document.querySelector(PANE_SELECTOR))) : null;
}

export function useChatArea(): Rect | null {
  const [area, setArea] = useState<Rect | null>(measureChatArea);

  useEffect(() => {
    if (typeof ResizeObserver !== 'function') return;
    let watched: Element[] = [];
    const observer = new ResizeObserver(() => measure());
    const watch = () => {
      const next = [
        document.querySelector(COLUMN_SELECTOR),
        document.getElementById(PANEL_ID),
      ].filter((element): element is Element => element !== null);
      if (
        next.length === watched.length &&
        next.every((element, index) => element === watched[index])
      ) {
        return;
      }
      observer.disconnect();
      next.forEach((element) => observer.observe(element));
      watched = next;
    };
    const measure = () => {
      watch();
      const next = measureChatArea();
      setArea((current) => (sameRect(current, next) ? current : next));
    };
    const settle = (event: TransitionEvent) => {
      if (event.target instanceof Element && event.target.closest(`#${PANEL_ID}`)) measure();
    };
    measure();
    window.addEventListener('resize', measure);
    document.addEventListener('transitionend', settle);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      document.removeEventListener('transitionend', settle);
    };
  }, []);

  return area;
}
