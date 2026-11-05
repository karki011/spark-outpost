import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { prefersReducedMotion } from '../ui/motion.ts';

const START_DELAY_MS = 400;
const PIXELS_PER_SECOND = 36;
const SCROLL_SHARE = 0.65;
const MIN_SCROLL_S = 1.2;

const sizeChecks = new Map<Element, () => void>();
let sizeObserver: ResizeObserver | null = null;

function observeSize(element: Element, check: () => void): () => void {
  sizeObserver ??= new ResizeObserver((entries) => {
    for (const entry of entries) sizeChecks.get(entry.target)?.();
  });
  sizeChecks.set(element, check);
  sizeObserver.observe(element);
  return () => {
    sizeChecks.delete(element);
    sizeObserver?.unobserve(element);
  };
}

function useOverflow(text: string) {
  const [element, ref] = useState<HTMLSpanElement | null>(null);
  const [truncated, setTruncated] = useState(false);
  useEffect(() => {
    if (!element) return;
    const check = () => setTruncated(element.scrollWidth > element.clientWidth);
    check();
    return observeSize(element, check);
  }, [element, text]);
  const measure = useCallback(
    () => (element ? Math.max(0, element.scrollWidth - element.clientWidth) : 0),
    [element],
  );
  return { ref, truncated, measure };
}

export function useMarquee(text: string) {
  const { ref, truncated, measure } = useOverflow(text);
  const [shift, setShift] = useState(0);
  const [running, setRunning] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const overflow = truncated ? Math.max(shift, 1) : 0;

  const stop = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setRunning(false);
  }, []);

  const start = useCallback(() => {
    if (!truncated || prefersReducedMotion() || timer.current) return;
    setShift(measure());
    timer.current = setTimeout(() => setRunning(true), START_DELAY_MS);
  }, [truncated, measure]);

  useEffect(() => stop, [stop]);

  return { ref, overflow, running: running && overflow > 0, start, stop };
}

interface RowTitleProps {
  text: string;
  overflow: number;
  running: boolean;
  titleRef: (element: HTMLSpanElement | null) => void;
}

export function RowTitle({ text, overflow, running, titleRef }: RowTitleProps) {
  const scrollSeconds = Math.max(MIN_SCROLL_S, overflow / PIXELS_PER_SECOND);
  const style = running
    ? ({
        '--mq-shift': `-${overflow}px`,
        '--mq-dur': `${(scrollSeconds / SCROLL_SHARE).toFixed(2)}s`,
      } as CSSProperties)
    : undefined;
  return (
    <span
      ref={titleRef}
      className="tt"
      data-truncated={overflow > 0 || undefined}
      data-marquee={running || undefined}
      style={style}
    >
      <span>{text}</span>
    </span>
  );
}
