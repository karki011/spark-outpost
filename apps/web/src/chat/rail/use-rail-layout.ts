import { useCallback, useId, useLayoutEffect, useState, type RefObject } from 'react';
import type { WideWindowLayout } from '@spark-outpost/contracts';
import { RAIL_MIN_ROOM, railClass, railState, type RailState } from './wide-layout.ts';
import { layoutParent } from '../../ui/layout-parent.ts';
import { usePhone } from '../../ui/breakpoints.ts';
import { SIDEBAR_DEFAULT_WIDTH, useSidebarLayout } from '../../conversations/sidebar-layout.tsx';
import { dockedSideWidth } from '../../conversations/sidebar-room.ts';

const COLLAPSED_KEY = 'spark-outpost.chat-rail.collapsed';

function roomBeside(main: HTMLElement): number {
  const frame = layoutParent(main) ?? main;
  return frame.getBoundingClientRect().right - main.getBoundingClientRect().left;
}

export function useRoomy(main: RefObject<HTMLElement | null>): boolean {
  const [roomy, setRoomy] = useState(false);
  const id = useId();
  const layout = useSidebarLayout();
  const reportRoom = layout?.reportRoom;
  const sideAllowance =
    layout?.floating && !layout.narrow
      ? dockedSideWidth(layout.width, SIDEBAR_DEFAULT_WIDTH, window.innerWidth)
      : 0;
  useLayoutEffect(() => {
    const element = main.current;
    if (!element || typeof ResizeObserver !== 'function') return;
    const measure = () => {
      setRoomy(roomBeside(element) - sideAllowance >= RAIL_MIN_ROOM);
      const width = element.getBoundingClientRect().width;
      reportRoom?.(id, width > 0 ? width : null);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    const frame = layoutParent(element);
    if (frame) observer.observe(frame);
    return () => observer.disconnect();
  }, [main, id, reportRoom, sideAllowance]);
  useLayoutEffect(() => () => reportRoom?.(id, null), [id, reportRoom]);
  return roomy;
}

const RAIL_BOTTOM_GAP = 16;

function railBounds(slot: HTMLElement, main: HTMLElement) {
  const frame = main.getBoundingClientRect();
  const thread = main.querySelector(':scope > .thread-wrap')?.getBoundingClientRect();
  const composer = main.querySelector(':scope > .composer-wrap')?.getBoundingClientRect();
  const top = (thread?.top ?? frame.top) - frame.top;
  const end = composer?.bottom ?? thread?.bottom ?? frame.bottom;
  slot.style.top = `${Math.max(0, top)}px`;
  slot.style.bottom = `${Math.max(0, frame.bottom - end + RAIL_BOTTOM_GAP)}px`;
}

export function useRailBounds(slotRef: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const slot = slotRef.current;
    const main = slot?.closest<HTMLElement>('.main');
    if (!slot || !main || typeof ResizeObserver !== 'function') return;
    const fit = () => railBounds(slot, main);
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(main);
    for (const part of main.querySelectorAll(':scope > .thread-wrap, :scope > .composer-wrap')) {
      observer.observe(part);
    }
    const children = new MutationObserver(fit);
    children.observe(main, { childList: true });
    return () => {
      observer.disconnect();
      children.disconnect();
    };
  }, [slotRef]);
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function useRailCollapsed(): [boolean, (collapsed: boolean) => void] {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const remember = useCallback((next: boolean) => {
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0');
    } catch {
      return;
    }
  }, []);
  return [collapsed, remember];
}

interface ChatRailInput {
  roomy: boolean;
  panelOpen: boolean;
  layout: WideWindowLayout;
  turns: number;
}

export interface ChatRailLayout {
  state: RailState;
  collapsed: boolean;
  className: string;
  setCollapsed(collapsed: boolean): void;
}

export function useChatRail(input: ChatRailInput): ChatRailLayout {
  const [docked, setDocked] = useRailCollapsed();
  const [floating, setFloating] = useState(false);
  const state = railState({ ...input, phone: usePhone(), collapsed: docked });
  const overlay = state === 'overlay';
  const setCollapsed = useCallback(
    (collapsed: boolean) => (overlay ? setFloating(!collapsed) : setDocked(collapsed)),
    [overlay, setDocked],
  );
  return {
    state,
    collapsed: overlay ? !floating : state === 'collapsed',
    className: railClass(state, overlay && floating),
    setCollapsed,
  };
}
