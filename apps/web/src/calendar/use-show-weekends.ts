import { useCallback, useState } from 'react';

const KEY = 'spark.calendar.weekends';

function saved(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function useShowWeekends() {
  const [shown, setShown] = useState(saved);
  const choose = useCallback((next: boolean) => {
    setShown(next);
    try {
      localStorage.setItem(KEY, next ? '1' : '0');
    } catch {
      return;
    }
  }, []);
  return [shown, choose] as const;
}
