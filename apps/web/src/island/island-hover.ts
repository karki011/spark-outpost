import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { onScoutBody, type ScoutHit } from '@spark-outpost/contracts';
import { shownBox } from './island-fit.ts';
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

function scoutEdge(scout: HTMLElement): number | null {
  return scout.dataset.edge === undefined ? null : Number(scout.dataset.edge);
}

function restingScout(island: HTMLElement | null): HTMLElement | null {
  return island?.matches('.peek') ? island.querySelector<HTMLElement>('.isl-scout-wrap') : null;
}

export function coreRects(island: HTMLElement | null): DOMRect[] {
  return island && !island.matches('.peek') ? [island.getBoundingClientRect()] : [];
}

export function scoutRects(island: HTMLElement | null): DOMRect[] {
  const scout = restingScout(island);
  if (!scout) return [];
  return [DOMRect.fromRect(shownBox(scout.getBoundingClientRect(), scoutEdge(scout)))];
}

export function scoutHit(island: HTMLElement | null): ScoutHit | null {
  const scout = island?.matches('.peek, [data-view="now"]')
    ? island.querySelector<HTMLElement>('.isl-scout-wrap')
    : null;
  if (!scout) return null;
  const { x, y, width, height } = scout.getBoundingClientRect();
  return { box: { x, y, width, height }, edge: scoutEdge(scout) };
}

export function onScout(island: HTMLElement | null, x: number, y: number): boolean {
  const hit = scoutHit(island);
  return hit ? onScoutBody(hit.box, hit.edge, x, y) : false;
}

export function flatRowRects(row: HTMLElement | null): DOMRect[] {
  if (!row?.matches('[data-flat]')) return [];
  return Array.from(row.querySelectorAll('[data-shown] button'), (element) =>
    element.getBoundingClientRect(),
  );
}

export function lineRects(island: HTMLElement | null): DOMRect[] {
  return Array.from(island?.querySelectorAll('.isl-restline') ?? [], (element) =>
    element.getBoundingClientRect(),
  );
}
