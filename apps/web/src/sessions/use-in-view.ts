import { useEffect, useState, type RefObject } from 'react';

export function useInView(ref: RefObject<Element | null>): boolean {
  const [seen, setSeen] = useState(() => typeof IntersectionObserver !== 'function');
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver !== 'function') return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setSeen(true);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return seen;
}
