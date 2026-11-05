import { useCallback, useState } from 'react';

export const DRAWER_MIN_WIDTH = 560;
export const DRAWER_DEFAULT_WIDTH = 1040;
const DRAWER_MARGIN = 40;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    return;
  }
}

export function drawerMaxWidth(): number {
  return Math.max(DRAWER_MIN_WIDTH, window.innerWidth - DRAWER_MARGIN);
}

export function clampDrawerWidth(width: number): number {
  return Math.round(Math.min(drawerMaxWidth(), Math.max(DRAWER_MIN_WIDTH, width)));
}

export function usePref<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    const saved = read(key);
    return allowed.find((option) => option === saved) ?? fallback;
  });
  const update = useCallback(
    (next: T) => {
      setValue(next);
      write(key, next);
    },
    [key],
  );
  return [value, update];
}

export function useDrawerWidth(): [number | null, (width: number | null) => void] {
  const key = 'spark-outpost.diff-drawer.width';
  const [width, setWidth] = useState<number | null>(() => {
    const saved = Number(read(key));
    return saved > 0 ? clampDrawerWidth(saved) : null;
  });
  const update = useCallback((next: number | null) => {
    const clamped = next === null ? null : clampDrawerWidth(next);
    setWidth(clamped);
    write(key, clamped === null ? null : String(clamped));
  }, []);
  return [width, update];
}
