import { useLayoutEffect, useState, type RefObject } from 'react';
import { RAIL_MIN_ROOM } from './wide-layout.ts';
import { layoutParent } from '../../ui/layout-parent.ts';

const COLLAPSED_KEY = 'spark-outpost.chat-rail.collapsed';

function roomBeside(main: HTMLElement): number {
  const frame = layoutParent(main) ?? main;
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
    const frame = layoutParent(element);
    if (frame) observer.observe(frame);
    return () => observer.disconnect();
  }, [main]);
  return roomy;
}

const RAIL_GUTTER = 52;

export function useRoomInThread(rail: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const element = rail.current;
    const thread = element?.closest('.thread');
    if (!element || !thread || typeof ResizeObserver !== 'function') return;
    const fit = () =>
      element.style.setProperty('max-height', `${thread.clientHeight - RAIL_GUTTER}px`);
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(thread);
    return () => observer.disconnect();
  }, [rail]);
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
