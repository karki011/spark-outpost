import { useEffect, useState } from 'react';

const TICK_MS = 60_000;

export function msToNextMinute(now: number): number {
  return TICK_MS - (now % TICK_MS);
}

export function useMinuteClock(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        setNow(Date.now());
        schedule();
      }, msToNextMinute(Date.now()));
    };
    schedule();
    return () => clearTimeout(timer);
  }, []);
  return now;
}
