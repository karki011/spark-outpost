import { useCallback, useSyncExternalStore } from 'react';

const TICK_MS = 15_000;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let now = Date.now();

function tick(): void {
  now = Date.now();
  listeners.forEach((notify) => notify());
}

function subscribe(listener: () => void): () => void {
  if (timer === null) {
    now = Date.now();
    timer = setInterval(tick, TICK_MS);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0 || timer === null) return;
    clearInterval(timer);
    timer = null;
  };
}

export function useClockText(text: (now: number) => string): string {
  const snapshot = useCallback(() => text(now), [text]);
  return useSyncExternalStore(subscribe, snapshot);
}
