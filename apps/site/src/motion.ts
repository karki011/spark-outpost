export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function onVisibility(
  element: Element,
  change: (visible: boolean) => void,
  rootMargin = '0px',
): void {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) change(entry.isIntersecting);
    },
    { rootMargin },
  );
  observer.observe(element);
}

export function onceVisible(element: Element, start: () => void, threshold = 0.35): void {
  const observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      start();
    },
    { threshold },
  );
  observer.observe(element);
}

export function scrollProgress(element: HTMLElement, update: (progress: number) => void): void {
  let frame = 0;
  const measure = () => {
    frame = 0;
    const rect = element.getBoundingClientRect();
    const travel = rect.height + window.innerHeight * 0.4;
    const passed = window.innerHeight * 0.85 - rect.top;
    update(Math.min(1, Math.max(0, passed / travel)));
  };
  const schedule = () => {
    if (frame === 0) frame = requestAnimationFrame(measure);
  };
  onVisibility(element, (visible) => {
    if (visible) {
      window.addEventListener('scroll', schedule, { passive: true });
      schedule();
    } else {
      window.removeEventListener('scroll', schedule);
      measure();
    }
  });
  window.addEventListener('resize', schedule, { passive: true });
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
