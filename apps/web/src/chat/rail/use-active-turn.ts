import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { turnAnchor } from './outline-model.ts';

const READING_BAND = '-12% 0px -68% 0px';
const JUMP_FALLBACK_MS = 1500;
const LANDED_PX = 24;

function landedOn(root: Element, section: HTMLElement): boolean {
  const atTop = Math.abs(section.getBoundingClientRect().top - root.getBoundingClientRect().top);
  const atEnd = root.scrollHeight - root.scrollTop - root.clientHeight;
  return atTop <= LANDED_PX || atEnd <= LANDED_PX;
}

export function useActiveTurn(anchor: RefObject<HTMLElement | null>, runIds: readonly string[]) {
  const [active, setActive] = useState<string | null>(null);
  const jumping = useRef(false);
  const inBand = useRef(new Set<string>());
  const key = runIds.join(' ');

  const followBand = useCallback(() => {
    const first = key.split(' ').find((id) => inBand.current.has(id));
    if (first) setActive(first);
  }, [key]);

  useEffect(() => {
    const root = anchor.current?.closest('.thread');
    if (!root || key === '' || typeof IntersectionObserver !== 'function') return;
    const band = inBand.current;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.turn;
          if (!id) continue;
          if (entry.isIntersecting) band.add(id);
          else band.delete(id);
        }
        if (!jumping.current) followBand();
      },
      { root, rootMargin: READING_BAND },
    );
    for (const id of key.split(' ')) {
      const section = document.getElementById(turnAnchor(id));
      if (section) observer.observe(section);
    }
    return () => {
      observer.disconnect();
      band.clear();
    };
  }, [anchor, key, followBand]);

  const jumped = useCallback(
    (runId: string) => {
      const root = anchor.current?.closest('.thread');
      const section = document.getElementById(turnAnchor(runId));
      if (!root || !section) return;
      jumping.current = true;
      setActive(runId);
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
    [anchor, followBand],
  );

  return { active, jumped };
}
