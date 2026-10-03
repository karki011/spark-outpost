import { useEffect, useState } from 'react';

export const SLOW_LOAD_MS = 8_000;

export function useSlowLoad(active: boolean, ms = SLOW_LOAD_MS): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setSlow(true), ms);
    return () => {
      clearTimeout(timer);
      setSlow(false);
    };
  }, [active, ms]);
  return active && slow;
}
