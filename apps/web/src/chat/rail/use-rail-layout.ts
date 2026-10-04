import { useLayoutEffect, useState, type RefObject } from 'react';
import { RAIL_MIN_ROOM } from './wide-layout.ts';

const COLLAPSED_KEY = 'spark-outpost.chat-rail.collapsed';

function roomBeside(main: HTMLElement): number {
  const frame = main.parentElement ?? main;
  return frame.getBoundingClientRect().right - main.getBoundingClientRect().left;
}

export function useRoomy(main: RefObject<HTMLElement | null>): boolean {
  const [roomy, setRoomy] = useState(false);
  useLayoutEffect(() => {
    const element = main.current;
    if (!element || typeof ResizeObserver !== 'function') return;
    const measure = () => setRoomy(roomBeside(element) >= RAIL_MIN_ROOM);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (element.parentElement) observer.observe(element.parentElement);
    return () => observer.disconnect();
  }, [main]);
  return roomy;
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function useRailCollapsed(): [boolean, (collapsed: boolean) => void] {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const remember = (next: boolean) => {
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0');
    } catch {
      return;
    }
  };
  return [collapsed, remember];
}
