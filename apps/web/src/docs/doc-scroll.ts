import { useEffect, useRef, type RefObject } from 'react';

const STATE_KEY = 'docsScroll';
const SETTLE_MS = 120;

interface SavedScroll {
  slug: string;
  top: number;
}

function scrollersOf(anchor: Element | null): HTMLElement[] {
  const main = anchor?.closest<HTMLElement>('.docs-main');
  const page = anchor?.closest<HTMLElement>('.page.docs');
  return [main, page].filter((element): element is HTMLElement => Boolean(element));
}

export function savedDocScroll(slug: string): number | null {
  const state: unknown = window.history.state;
  if (typeof state !== 'object' || state === null) return null;
  const saved = (state as Record<string, unknown>)[STATE_KEY] as Partial<SavedScroll> | undefined;
  return saved?.slug === slug && typeof saved.top === 'number' ? saved.top : null;
}

export function restoreDocScroll(anchor: Element | null, top: number): void {
  for (const scroller of scrollersOf(anchor)) {
    scroller.scrollTop = top;
    if (scroller.scrollTop === top) return;
  }
}

function save(saved: SavedScroll): void {
  const state: unknown = window.history.state;
  const base = typeof state === 'object' && state !== null ? state : {};
  window.history.replaceState({ ...base, [STATE_KEY]: saved }, '');
}

export function useRememberDocScroll(anchor: RefObject<Element | null>, slug: string): void {
  const current = useRef(slug);
  useEffect(() => {
    current.current = slug;
  }, [slug]);
  useEffect(() => {
    const scrollers = scrollersOf(anchor.current);
    let timer = 0;
    const onScroll = (event: Event) => {
      const saved = { slug: current.current, top: (event.currentTarget as HTMLElement).scrollTop };
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (current.current === saved.slug) save(saved);
      }, SETTLE_MS);
    };
    for (const scroller of scrollers)
      scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.clearTimeout(timer);
      for (const scroller of scrollers) scroller.removeEventListener('scroll', onScroll);
    };
  }, [anchor]);
}
