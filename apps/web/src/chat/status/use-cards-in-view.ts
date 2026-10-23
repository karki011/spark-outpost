import { useEffect, useState } from 'react';
import { approvalAnchor } from '../../crew/conversation-crew.ts';

const FIND_TRIES = 30;

export function useCardsInView(ids: readonly string[]): boolean {
  const key = ids.join('\n');
  const [view, setView] = useState<{ key: string; seen: boolean | null }>({ key, seen: null });
  useEffect(() => {
    const wanted = key === '' ? [] : key.split('\n');
    if (wanted.length === 0 || typeof IntersectionObserver !== 'function') return;
    const visible = new Set<string>();
    let observer: IntersectionObserver | null = null;
    let frame = 0;
    let tries = FIND_TRIES;
    const attach = () => {
      const cards = wanted.flatMap((id) => {
        const card = document.getElementById(approvalAnchor(id));
        return card ? [card] : [];
      });
      if (cards.length === 0) {
        if (tries > 0) {
          tries -= 1;
          frame = requestAnimationFrame(attach);
        } else {
          setView({ key, seen: false });
        }
        return;
      }
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) visible.add(entry.target.id);
            else visible.delete(entry.target.id);
          }
          setView({ key, seen: visible.size > 0 });
        },
        { root: cards[0]!.closest('.thread') },
      );
      for (const card of cards) observer.observe(card);
    };
    attach();
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [key]);
  if (ids.length === 0 || typeof IntersectionObserver !== 'function') return false;
  return view.key === key ? view.seen !== false : true;
}
