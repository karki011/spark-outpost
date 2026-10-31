import { useEffect, useState } from 'react';

const INPUTS = ['pointermove', 'pointerdown', 'keydown', 'wheel'] as const;

export function useIdleAfter(ms: number): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const wake = () => {
      clearTimeout(timer);
      setIdle(false);
      timer = setTimeout(() => setIdle(true), ms);
    };
    for (const type of INPUTS) window.addEventListener(type, wake, { passive: true });
    document.addEventListener('visibilitychange', wake);
    wake();
    return () => {
      clearTimeout(timer);
      for (const type of INPUTS) window.removeEventListener(type, wake);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [ms]);
  return idle;
}
