import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { NO_ANCHOR, nextAnchorState, type AnchorEvent } from './anchor-state.ts';

const READING_BAND = '-12% 0px -68% 0px';
const JUMP_TIMEOUT_MS = 1500;
const LANDED_PX = 24;

function landedOn(root: Element, anchor: string): boolean {
  const section = document.getElementById(anchor);
  if (!section) return false;
  const below = section.getBoundingClientRect().top - root.getBoundingClientRect().top;
  const toEnd = root.scrollHeight - root.scrollTop - root.clientHeight;
  return Math.abs(below) <= LANDED_PX || (below > 0 && toEnd <= LANDED_PX);
}

export function useActiveAnchor(
  scroller: RefObject<HTMLElement | null>,
  anchors: readonly string[],
) {
  const [active, setActive] = useState<string | null>(null);
  const state = useRef(NO_ANCHOR);
  const inBand = useRef(new Set<string>());
  const timeout = useRef(0);
  const key = anchors.join(' ');

  const inView = useCallback(() => {
    const shown = key.split(' ').filter((id) => inBand.current.has(id));
    const first = shown[0] ? document.getElementById(shown[0]) : null;
    return shown.findLast((id) => first?.contains(document.getElementById(id))) ?? null;
  }, [key]);

  const send = useCallback((event: AnchorEvent) => {
    state.current = nextAnchorState(state.current, event);
    if (!state.current.jump) window.clearTimeout(timeout.current);
    setActive(state.current.active);
  }, []);

  useEffect(() => {
    const root = scroller.current;
    if (!root || key === '' || typeof IntersectionObserver !== 'function') return;
    const band = inBand.current;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) band.add(entry.target.id);
          else band.delete(entry.target.id);
        }
        send({ type: 'band', inView: inView() });
      },
      { root, rootMargin: READING_BAND },
    );
    for (const id of key.split(' ')) {
      const section = document.getElementById(id);
      if (section) observer.observe(section);
    }
    const scrollEnded = () => {
      const jump = state.current.jump;
      if (jump) send({ type: 'scrollend', landed: landedOn(root, jump.anchor), inView: inView() });
    };
    const takenOver = () => {
      if (state.current.jump?.released === false) send({ type: 'takeover', inView: inView() });
    };
    root.addEventListener('scrollend', scrollEnded);
    root.addEventListener('wheel', takenOver, { passive: true });
    root.addEventListener('touchmove', takenOver, { passive: true });
    return () => {
      observer.disconnect();
      band.clear();
      root.removeEventListener('scrollend', scrollEnded);
      root.removeEventListener('wheel', takenOver);
      root.removeEventListener('touchmove', takenOver);
    };
  }, [scroller, key, inView, send]);

  useEffect(() => () => window.clearTimeout(timeout.current), []);

  const jumped = (anchor: string) => {
    if (!scroller.current || !document.getElementById(anchor)) return;
    window.clearTimeout(timeout.current);
    send({ type: 'jump', anchor });
    timeout.current = window.setTimeout(() => {
      const root = scroller.current;
      if (root) send({ type: 'timeout', landed: landedOn(root, anchor), inView: inView() });
    }, JUMP_TIMEOUT_MS);
  };

  return { active, jumped };
}
