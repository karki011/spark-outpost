import { useCallback, useEffect, useLayoutEffect, type RefObject } from 'react';
import { isOutOfView, toolbarPlacement, type Box } from './toolbar-position.ts';

const COMPACT_BELOW = 440;

function visibleRects(range: Range): DOMRect[] {
  return Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
}

function horizontalBounds(scroller: HTMLElement): Pick<Box, 'left' | 'right'> {
  const column = scroller.querySelector('.col')?.getBoundingClientRect();
  const view = scroller.getBoundingClientRect();
  const left = Math.max(view.left, column?.left ?? view.left, 0);
  const right = Math.min(view.right, column?.right ?? view.right, window.innerWidth);
  return { left, right };
}

interface LayoutOptions {
  range: Range | null;
  scrollerRef: RefObject<HTMLElement | null>;
  toolbarRef: RefObject<HTMLElement | null>;
  revision: string;
}

function hide(toolbar: HTMLElement) {
  toolbar.dataset.shown = 'false';
}

export function isToolbarShown(toolbar: HTMLElement | null): boolean {
  return toolbar?.dataset.shown === 'true';
}

export function useToolbarLayout({ range, scrollerRef, toolbarRef, revision }: LayoutOptions) {
  const measure = useCallback(() => {
    const scroller = scrollerRef.current;
    const toolbar = toolbarRef.current;
    const wrap = scroller?.parentElement;
    if (!toolbar) return;
    if (!range || !scroller || !wrap) return hide(toolbar);
    const rects = visibleRects(range);
    const start = rects[0];
    const end = rects.at(-1);
    if (!start || !end) return hide(toolbar);
    const view = scroller.getBoundingClientRect();
    const bounds: Box = {
      ...horizontalBounds(scroller),
      top: Math.max(view.top, 0),
      bottom: Math.min(view.bottom, window.innerHeight),
    };
    if (isOutOfView({ start, end, bounds })) return hide(toolbar);
    toolbar.dataset.compact = String(bounds.right - bounds.left < COMPACT_BELOW);
    const size = { width: toolbar.offsetWidth, height: toolbar.offsetHeight };
    const placed = toolbarPlacement({ start, end, bounds, size });
    const origin = wrap.getBoundingClientRect();
    toolbar.style.left = `${Math.round(placed.left - origin.left)}px`;
    toolbar.style.top = `${Math.round(placed.top - origin.top)}px`;
    toolbar.dataset.side = placed.side;
    toolbar.dataset.shown = 'true';
  }, [range, scrollerRef, toolbarRef]);

  useLayoutEffect(() => {
    if (revision) measure();
  }, [measure, revision]);

  useEffect(() => {
    if (!range) return;
    const scroller = scrollerRef.current;
    scroller?.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      scroller?.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [range, scrollerRef, measure]);
}
