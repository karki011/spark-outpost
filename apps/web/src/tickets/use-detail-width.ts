import { useCallback, useState } from 'react';
import { clampDetailWidth, parseDetailWidth } from './detail-width.ts';

const WIDTH_KEY = 'spark-outpost.tickets.detail-width';

function readWidth(): number | null {
  try {
    return parseDetailWidth(localStorage.getItem(WIDTH_KEY));
  } catch {
    return null;
  }
}

export function useDetailWidth() {
  const [width, setWidthState] = useState<number | null>(readWidth);
  const setWidth = useCallback((next: number | null) => {
    const clamped = next === null ? null : clampDetailWidth(next);
    setWidthState(clamped);
    try {
      if (clamped === null) localStorage.removeItem(WIDTH_KEY);
      else localStorage.setItem(WIDTH_KEY, String(clamped));
    } catch {
      return;
    }
  }, []);
  return [width, setWidth] as const;
}
