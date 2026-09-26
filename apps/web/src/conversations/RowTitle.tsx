import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { prefersReducedMotion } from '../ui/motion.ts';

const START_DELAY_MS = 400;
const PIXELS_PER_SECOND = 36;
const SCROLL_SHARE = 0.65;
const MIN_SCROLL_S = 1.2;

function useOverflow(text: string) {
  const [element, ref] = useState<HTMLSpanElement | null>(null);
  const [overflow, setOverflow] = useState(0);
  useEffect(() => {
    if (!element) return;
    const measure = () => setOverflow(Math.max(0, element.scrollWidth - element.clientWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, text]);
  return { ref, overflow };
}

export function useMarquee(text: string) {
  const { ref, overflow } = useOverflow(text);
  const [running, setRunning] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setRunning(false);
  }, []);

  const start = useCallback(() => {
    if (overflow === 0 || prefersReducedMotion() || timer.current) return;
    timer.current = setTimeout(() => setRunning(true), START_DELAY_MS);
  }, [overflow]);

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
