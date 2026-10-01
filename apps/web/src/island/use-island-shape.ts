import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { Spring } from './springs.ts';

export interface ScoutSpot {
  x: number;
  y: number;
  size: number;
}

export interface ShapeTarget {
  width: number;
  height: number;
  radius: number;
  scout: ScoutSpot;
}

const MAX_DT = 0.05;

interface Springs {
  width: Spring;
  height: Spring;
  radius: Spring;
  scoutX: Spring;
  scoutY: Spring;
  scoutSize: Spring;
}

function makeSprings(start: ShapeTarget): Springs {
  return {
    width: new Spring(start.width),
    height: new Spring(start.height),
    radius: new Spring(start.radius),
    scoutX: new Spring(start.scout.x),
    scoutY: new Spring(start.scout.y),
    scoutSize: new Spring(start.scout.size),
  };
}

export function useIslandShape(
  islandRef: RefObject<HTMLElement | null>,
  scoutRef: RefObject<HTMLElement | null>,
  start: ShapeTarget,
  instant: boolean,
): (target: ShapeTarget, scoutResponse?: number) => void {
  const springs = useRef<Springs | null>(null);
  springs.current ??= makeSprings(start);
  const frame = useRef(0);
  const last = useRef(0);
  const instantRef = useRef(instant);

  useEffect(() => {
    instantRef.current = instant;
  }, [instant]);

  const apply = useCallback(() => {
    const s = springs.current!;
    const island = islandRef.current;
    if (island) {
      island.style.width = `${s.width.value}px`;
      island.style.height = `${s.height.value}px`;
      island.style.setProperty('--island-r', `${s.radius.value}px`);
    }
    const scout = scoutRef.current;
    if (scout) {
      const size = s.scoutSize.value;
      scout.style.width = `${size}px`;
      scout.style.height = `${size}px`;
      scout.style.transform = `translate(${s.scoutX.value}px, ${s.scoutY.value}px)`;
    }
  }, [islandRef, scoutRef]);

  const step = useRef<(now: number) => void>(() => undefined);

  useLayoutEffect(() => {
    step.current = (now: number) => {
      const dt = Math.min(MAX_DT, (now - last.current) / 1000);
      last.current = now;
      let busy = false;
      for (const spring of Object.values(springs.current!) as Spring[]) {
        spring.step(dt, now);
        busy ||= spring.busy;
      }
      apply();
      frame.current = busy ? requestAnimationFrame(step.current) : 0;
    };
  }, [apply]);

  useEffect(() => {
    apply();
    if (!frame.current && Object.values(springs.current!).some((spring: Spring) => spring.busy)) {
      last.current = performance.now();
      frame.current = requestAnimationFrame(step.current);
    }
    return () => {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [apply]);

  return useCallback(
    (target: ShapeTarget, scoutResponse = 0.5) => {
      const s = springs.current!;
      if (instantRef.current) {
        s.width.jump(target.width);
        s.height.jump(target.height);
        s.radius.jump(target.radius);
        s.scoutX.jump(target.scout.x);
        s.scoutY.jump(target.scout.y);
        s.scoutSize.jump(target.scout.size);
        apply();
        return;
      }
      const now = performance.now();
      const growing = target.width >= s.width.target - 1 && target.height >= s.height.target - 1;
      for (const [spring, value] of [
        [s.width, target.width],
        [s.height, target.height],
        [s.radius, target.radius],
      ] as const) {
        if (growing) spring.springTo(value);
        else spring.easeTo(value, now);
      }
      s.scoutX.springTo(target.scout.x, scoutResponse, 0.74);
      s.scoutY.springTo(target.scout.y, scoutResponse, 0.68);
      s.scoutSize.springTo(target.scout.size, scoutResponse, 0.7);
      if (frame.current) return;
      last.current = now;
      frame.current = requestAnimationFrame(step.current);
    },
    [apply],
  );
}
