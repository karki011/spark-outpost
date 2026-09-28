import { useSyncExternalStore } from 'react';

const MINUTE = 60_000;
const TICK_MS = 15_000;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  timer ??= setInterval(() => listeners.forEach((notify) => notify()), TICK_MS);
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0 || timer === null) return;
    clearInterval(timer);
    timer = null;
  };
}

function currentMinute(): number {
  return Math.floor(Date.now() / MINUTE) * MINUTE;
}

export function useMinute(): number {
  return useSyncExternalStore(subscribe, currentMinute);
}
