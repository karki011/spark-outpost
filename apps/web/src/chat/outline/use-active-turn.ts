import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

const READING_BAND = '-12% 0px -68% 0px';
const JUMP_FALLBACK_MS = 1500;
const LANDED_PX = 24;

function landedOn(root: Element, section: HTMLElement): boolean {
  const atTop = Math.abs(section.getBoundingClientRect().top - root.getBoundingClientRect().top);
  const atEnd = root.scrollHeight - root.scrollTop - root.clientHeight;
  return atTop <= LANDED_PX || atEnd <= LANDED_PX;
}

export function useActiveAnchor(
  scroller: RefObject<HTMLElement | null>,
  anchors: readonly string[],
) {
  const [active, setActive] = useState<string | null>(null);
  const jumping = useRef(false);
  const inBand = useRef(new Set<string>());
  const key = anchors.join(' ');

  const followBand = useCallback(() => {
    const shown = key.split(' ').filter((id) => inBand.current.has(id));
    const first = shown[0] ? document.getElementById(shown[0]) : null;
    const within = shown.findLast((id) => first?.contains(document.getElementById(id)));
    if (within) setActive(within);
  }, [key]);

  useEffect(() => {
    const root = scroller.current;
    if (!root || key === '' || typeof IntersectionObserver !== 'function') return;
    const band = inBand.current;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.id;
          if (entry.isIntersecting) band.add(id);
          else band.delete(id);
        }
        if (!jumping.current) followBand();
      },
      { root, rootMargin: READING_BAND },
    );
    for (const id of key.split(' ')) {
      const section = document.getElementById(id);
      if (section) observer.observe(section);
    }
    return () => {
      observer.disconnect();
      band.clear();
    };
  }, [scroller, key, followBand]);

  const jumped = useCallback(
    (anchor: string) => {
      const root = scroller.current;
      const section = document.getElementById(anchor);
      if (!root || !section) return;
      jumping.current = true;
      setActive(anchor);
      let fallback = 0;
      const settle = () => {
        window.clearTimeout(fallback);
        root.removeEventListener('scrollend', settle);
        jumping.current = false;
        if (!landedOn(root, section)) followBand();
      };
      fallback = window.setTimeout(settle, JUMP_FALLBACK_MS);
      root.addEventListener('scrollend', settle);
    },
    [scroller, followBand],
  );

  return { active, jumped };
}
