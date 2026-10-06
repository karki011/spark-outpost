import { useSyncExternalStore } from 'react';

const TICK_MS = 10_000;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let current = Date.now();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  current = Date.now();
  timer ??= setInterval(() => {
    current = Date.now();
    listeners.forEach((notify) => notify());
  }, TICK_MS);
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0 || timer === null) return;
    clearInterval(timer);
    timer = null;
  };
}

export function useTenSeconds(): number {
  return useSyncExternalStore(subscribe, () => current);
}
