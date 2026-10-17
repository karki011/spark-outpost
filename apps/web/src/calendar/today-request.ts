import { useEffect } from 'react';

let pending: string | null = null;
const listeners = new Set<() => void>();

export function requestTodayEvent(eventKey: string): void {
  pending = eventKey;
  listeners.forEach((listener) => listener());
}

function takeTodayEvent(): string | null {
  const asked = pending;
  pending = null;
  return asked;
}

export function useTodayEventRequests(select: (eventKey: string) => void): void {
  useEffect(() => {
    const take = () => {
      const eventKey = takeTodayEvent();
      if (eventKey) select(eventKey);
    };
    take();
    listeners.add(take);
    return () => {
      listeners.delete(take);
    };
  }, [select]);
}
