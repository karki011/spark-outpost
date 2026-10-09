import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { hoverZone, shownBox } from './island-fit.ts';
import { noteSeen } from './use-island-moments.ts';

const MINUTE_MS = 60_000;
const HOVER_IN_MS = 140;
const HOVER_OUT_MS = 400;

export function useHoverIntent(settleRef: RefObject<(inside: boolean) => void>) {
  const [hover, setHover] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const entering = useRef(false);
  const onHover = useCallback(
    (inside: boolean) => {
      clearTimeout(timer.current);
      entering.current = inside;
      timer.current = setTimeout(
        () => {
          setHover(inside);
          settleRef.current(inside);
        },
        inside ? HOVER_IN_MS : HOVER_OUT_MS,
      );
      if (inside) noteSeen();
    },
    [settleRef],
  );
  const cancelEnter = useCallback(() => {
    if (entering.current) clearTimeout(timer.current);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return [hover, onHover, cancelEnter] as const;
}

export function minuteOf(time: number): number {
  return Math.floor(time / MINUTE_MS) * MINUTE_MS;
}

function scoutRect(scout: HTMLElement): DOMRect {
  const edge = scout.dataset.edge === undefined ? null : Number(scout.dataset.edge);
  return DOMRect.fromRect(shownBox(scout.getBoundingClientRect(), edge));
}

function restingScout(island: HTMLElement | null): HTMLElement | null {
  return island?.matches('.peek') ? island.querySelector<HTMLElement>('.isl-scout-wrap') : null;
}

export function coreRects(island: HTMLElement | null): DOMRect[] {
  if (!island) return [];
  const scout = restingScout(island);
  return [island.getBoundingClientRect(), ...(scout ? [scoutRect(scout)] : [])];
}

export function zoneRects(island: HTMLElement | null, reach: number, docked: boolean): DOMRect[] {
  const scout = island?.matches('.tucked, .floating') ? restingScout(island) : null;
  return scout ? [DOMRect.fromRect(hoverZone(scoutRect(scout), reach, docked))] : [];
}

export function flatRowRects(row: HTMLElement | null): DOMRect[] {
  if (!row?.matches('[data-flat]')) return [];
  return Array.from(row.querySelectorAll('[data-shown] button'), (element) =>
    element.getBoundingClientRect(),
  );
}
