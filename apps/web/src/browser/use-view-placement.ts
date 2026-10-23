import { useCallback, useEffect, type RefObject } from 'react';
import type { BrowserBounds, BrowserPlacement } from '@spark-outpost/contracts';
import { desktopBrowser } from '../desktop/desktop-bridge.ts';

export interface BrowserHome {
  chatId: string;
  projectId: string | null;
  roots: readonly string[];
  sendsTo: 'chat' | 'terminal';
}

export function hiddenPlacement(home: BrowserHome): BrowserPlacement {
  return {
    chatId: home.chatId,
    projectId: home.projectId,
    roots: [...home.roots].slice(0, 16),
    bounds: null,
    covered: false,
    sendsTo: home.sendsTo,
  };
}

const PROBE_INSET = 6;
const SETTLE_MS = 320;
const DRAG_HANDLES = '[role="separator"]';

function boundsOf(element: HTMLElement): BrowserBounds | null {
  if (!element.isConnected || !element.checkVisibility({ visibilityProperty: true })) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return null;
  return {
    x: Math.max(0, Math.round(rect.left)),
    y: Math.max(0, Math.round(rect.top)),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

function probePoints(bounds: BrowserBounds): [number, number][] {
  const left = bounds.x + PROBE_INSET;
  const right = bounds.x + bounds.width - PROBE_INSET;
  const top = bounds.y + PROBE_INSET;
  const bottom = bounds.y + bounds.height - PROBE_INSET;
  const midX = bounds.x + bounds.width / 2;
  const midY = bounds.y + bounds.height / 2;
  return [
    [left, top],
    [midX, top],
    [right, top],
    [left, midY],
    [midX, midY],
    [right, midY],
    [left, bottom],
    [midX, bottom],
    [right, bottom],
  ];
}

function overlapped(element: HTMLElement, bounds: BrowserBounds): boolean {
  return probePoints(bounds).some(([x, y]) => {
    const top = document.elementFromPoint(x, y);
    return top !== null && !element.contains(top);
  });
}

export type PlaceView = (bounds: BrowserBounds | null, covered: boolean) => void;

export function useViewPlacement(
  target: RefObject<HTMLElement | null>,
  home: BrowserHome,
  shown: boolean,
): void {
  const { chatId, projectId, sendsTo } = home;
  const rootsKey = home.roots.join('\n');
  const place = useCallback<PlaceView>(
    (bounds, covered) => {
      const roots = rootsKey === '' ? [] : rootsKey.split('\n').slice(0, 16);
      const placement: BrowserPlacement = { chatId, projectId, roots, bounds, covered, sendsTo };
      void desktopBrowser()?.place(placement);
    },
    [chatId, projectId, rootsKey, sendsTo],
  );
  useNativePlacement(target, shown && desktopBrowser() !== null, place);
}

export function useNativePlacement(
  target: RefObject<HTMLElement | null>,
  shown: boolean,
  place: PlaceView,
): void {
  useEffect(() => {
    const element = target.current;
    if (!element) return;
    const panel = element.closest('.wp');
    const inner = panel?.querySelector(':scope > .wp-in') ?? null;
    let sent = '';
    let frame = 0;
    let settle = 0;
    let animating = 0;
    let dragging = false;

    let watching = false;
    const overlay = new MutationObserver(() => schedule());
    const watchOverlay = (covered: boolean) => {
      if (covered === watching) return;
      watching = covered;
      if (covered) overlay.observe(document.body, { childList: true, subtree: true });
      else overlay.disconnect();
    };
    const report = () => {
      frame = 0;
      const bounds = shown ? boundsOf(element) : null;
      const covered = bounds !== null && (dragging || overlapped(element, bounds));
      watchOverlay(covered);
      const key = JSON.stringify({ bounds, covered });
      if (key === sent) return;
      sent = key;
      place(bounds, covered);
    };
    function schedule() {
      frame ||= requestAnimationFrame(report);
    }
    const scheduleSettled = () => {
      schedule();
      clearTimeout(settle);
      settle = window.setTimeout(schedule, SETTLE_MS);
    };
    const follow = () => {
      report();
      animating = animating > 0 ? requestAnimationFrame(follow) : 0;
    };
    const onTransitionRun = (event: Event) => {
      const moving = event.target === panel || event.target === inner;
      if (moving && animating === 0) animating = requestAnimationFrame(follow);
    };
    const onTransitionEnd = () => {
      cancelAnimationFrame(animating);
      animating = 0;
      scheduleSettled();
    };
    const onPointerDown = (event: PointerEvent) => {
      dragging = event.target instanceof Element && event.target.closest(DRAG_HANDLES) !== null;
      scheduleSettled();
    };
    const onPointerUp = () => {
      dragging = false;
      scheduleSettled();
    };

    const resize = new ResizeObserver(schedule);
    resize.observe(element);
    window.addEventListener('resize', schedule);
    panel?.addEventListener('transitionrun', onTransitionRun);
    panel?.addEventListener('transitionend', onTransitionEnd);
    panel?.addEventListener('transitioncancel', onTransitionEnd);
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('pointerup', onPointerUp, true);
    window.addEventListener('pointercancel', onPointerUp, true);
    window.addEventListener('keyup', scheduleSettled, true);
    window.addEventListener('focusin', scheduleSettled, true);
    scheduleSettled();

    return () => {
      resize.disconnect();
      overlay.disconnect();
      window.removeEventListener('resize', schedule);
      panel?.removeEventListener('transitionrun', onTransitionRun);
      panel?.removeEventListener('transitionend', onTransitionEnd);
      panel?.removeEventListener('transitioncancel', onTransitionEnd);
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('pointerup', onPointerUp, true);
      window.removeEventListener('pointercancel', onPointerUp, true);
      window.removeEventListener('keyup', scheduleSettled, true);
      window.removeEventListener('focusin', scheduleSettled, true);
      cancelAnimationFrame(frame);
      cancelAnimationFrame(animating);
      clearTimeout(settle);
      place(null, false);
    };
  }, [target, shown, place]);
}
