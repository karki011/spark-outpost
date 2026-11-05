import { useLayoutEffect, useRef, useState } from 'react';

export function useChartWidth<T extends HTMLElement>(fallback: number, min: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setWidth(Math.max(min, Math.floor(element.clientWidth)));
    measure();
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [min]);
  return { ref, width };
}
