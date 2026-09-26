import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Box } from './tv-layout.ts';

function subscribeVisibility(listener: () => void) {
  document.addEventListener('visibilitychange', listener);
  return () => document.removeEventListener('visibilitychange', listener);
}

export function usePageHidden(): boolean {
  return useSyncExternalStore(subscribeVisibility, () => document.visibilityState === 'hidden');
}

function subscribeResize(listener: () => void) {
  window.addEventListener('resize', listener);
  return () => window.removeEventListener('resize', listener);
}

function viewportKey(): string {
  return `${innerWidth}x${innerHeight}`;
}

export function useViewport(): Box {
  const key = useSyncExternalStore(subscribeResize, viewportKey);
  const [width, height] = key.split('x').map(Number);
  return { width: width!, height: height! };
}

export function useThrottledText(text: string, delayMs: number): string {
  const latest = useRef(text);
  const [spoken, setSpoken] = useState(text);
  const pending = text !== spoken;

  useEffect(() => {
    latest.current = text;
  });

  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => setSpoken(latest.current), delayMs);
    return () => clearTimeout(timer);
  }, [pending, delayMs]);

  return spoken;
}
