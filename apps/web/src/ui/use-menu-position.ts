import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react';

const GAP = 6;
const EDGE = 8;
export const MENU_MAX_HEIGHT = 320;

interface MenuPositionOptions {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  panelRef: RefObject<HTMLElement | null>;
  wantedHeight: number;
}

export function useMenuPosition({
  open,
  anchorRef,
  panelRef,
  wantedHeight,
}: MenuPositionOptions): CSSProperties {
  const [position, setPosition] = useState<CSSProperties>({});

  const place = useCallback(() => {
    if (!anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom;
    const upward = below < Math.min(MENU_MAX_HEIGHT, wantedHeight) && rect.top > below;
    const minWidth = panelRef.current ? parseFloat(getComputedStyle(panelRef.current).minWidth) : 0;
    const shown = Math.max(rect.width, Number.isFinite(minWidth) ? minWidth : 0);
    setPosition({
      left: Math.max(EDGE, Math.min(rect.left, window.innerWidth - shown - EDGE)),
      width: rect.width,
      ...(upward
        ? { bottom: window.innerHeight - rect.top + GAP, transformOrigin: 'bottom center' }
        : { top: rect.bottom + GAP, transformOrigin: 'top center' }),
      maxHeight: Math.min(MENU_MAX_HEIGHT, (upward ? rect.top : below) - GAP * 3),
    });
  }, [anchorRef, panelRef, wantedHeight]);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const follow = (event: Event) => {
      if (event.target instanceof Node && panelRef.current?.contains(event.target)) return;
      place();
    };
    window.addEventListener('resize', place);
    window.addEventListener('scroll', follow, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', follow, true);
    };
  }, [open, panelRef, place]);

  return position;
}
