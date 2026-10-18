import { useLayoutEffect, useState, type RefObject } from 'react';
import { titlesThatFit } from './month-model.ts';

const FIRST_GUESS = 3;

export function useTitlesThatFit(gridRef: RefObject<HTMLElement | null>): number {
  const [titles, setTitles] = useState(FIRST_GUESS);
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const measure = () => {
      const list = grid.querySelector<HTMLElement>('.mo-evs');
      if (!list) return;
      const row = Number.parseFloat(getComputedStyle(list).getPropertyValue('--mo-ev-row'));
      setTitles(titlesThatFit(list.clientHeight, row));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [gridRef]);
  return titles;
}
