import { useCallback, useRef, useState } from 'react';

export const FOLLOW_THRESHOLD_PX = 80;

export interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

export function distanceFromBottom(metrics: ScrollMetrics): number {
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight;
}

export function nextFollowing(
  following: boolean,
  metrics: ScrollMetrics,
  previousTop: number,
): boolean {
  if (distanceFromBottom(metrics) <= FOLLOW_THRESHOLD_PX) return true;
  if (metrics.scrollTop < previousTop) return false;
  return following;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function useStickToBottom() {
  const element = useRef<HTMLDivElement | null>(null);
  const following = useRef(true);
  const gliding = useRef(false);
  const lastTop = useRef(0);
  const [away, setAway] = useState(false);

  const toBottom = useCallback((smooth: boolean) => {
    const scroller = element.current;
    if (!scroller) return;
    if (smooth) {
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
      return;
    }
    scroller.scrollTop = scroller.scrollHeight;
    lastTop.current = scroller.scrollTop;
  }, []);

  const scrollerRef = useCallback(
    (scroller: HTMLDivElement | null) => {
      element.current = scroller;
      if (!scroller) return;
      const onResize = () => {
        if (following.current) toBottom(gliding.current);
      };
      const onScroll = () => {
        following.current = nextFollowing(following.current, scroller, lastTop.current);
        lastTop.current = scroller.scrollTop;
        if (!following.current || distanceFromBottom(scroller) < 1) gliding.current = false;
        setAway(!following.current);
      };
      const observer = new ResizeObserver(onResize);
      observer.observe(scroller);
      for (const child of scroller.children) observer.observe(child);
      scroller.addEventListener('scroll', onScroll, { passive: true });
      return () => {
        observer.disconnect();
        scroller.removeEventListener('scroll', onScroll);
      };
    },
    [toBottom],
  );

  const follow = useCallback(() => {
    following.current = true;
    setAway(false);
    toBottom(false);
  }, [toBottom]);

  const unfollow = useCallback(() => {
    const scroller = element.current;
    if (!scroller) return;
    following.current = distanceFromBottom(scroller) <= FOLLOW_THRESHOLD_PX;
    setAway(!following.current);
  }, []);

  const release = useCallback(() => {
    following.current = false;
    gliding.current = false;
    setAway(true);
  }, []);

  const jumpToLatest = useCallback(() => {
    following.current = true;
    gliding.current = !prefersReducedMotion();
    setAway(false);
    toBottom(gliding.current);
  }, [toBottom]);

  return { scrollerRef, scroller: element, away, follow, unfollow, release, jumpToLatest };
}
