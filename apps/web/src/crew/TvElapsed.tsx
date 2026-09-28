import { useLayoutEffect, useRef } from 'react';
import { formatElapsed } from './tv-list.ts';

const TICK_MS = 1000;
const clocks = new Map<HTMLElement, number>();
let timer: ReturnType<typeof setInterval> | null = null;

function paint(element: HTMLElement, since: number, now = Date.now()) {
  const text = formatElapsed(now - since);
  if (element.textContent !== text) element.textContent = text;
}

function tick() {
  const now = Date.now();
  clocks.forEach((since, element) => paint(element, since, now));
}

function track(element: HTMLElement, since: number): () => void {
  clocks.set(element, since);
  paint(element, since);
  timer ??= setInterval(tick, TICK_MS);
  return () => {
    clocks.delete(element);
    if (clocks.size > 0 || timer === null) return;
    clearInterval(timer);
    timer = null;
  };
}

export function TvElapsed({ since }: { since: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    return element ? track(element, since) : undefined;
  }, [since]);
  return <span ref={ref} className="tvl-clock" />;
}
