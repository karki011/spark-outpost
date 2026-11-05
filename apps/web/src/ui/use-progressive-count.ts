import { startTransition, useEffect, useState } from 'react';

const FIRST = 40;
const STEP = 80;

export function useProgressiveCount(total: number): number {
  const [shown, setShown] = useState(FIRST);
  useEffect(() => {
    if (shown >= total) return;
    const timer = setTimeout(() => startTransition(() => setShown((count) => count + STEP)), 0);
    return () => clearTimeout(timer);
  }, [shown, total]);
  return Math.min(shown, total);
}
