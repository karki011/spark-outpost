import { scrollProgress } from './motion.ts';

function setUpReveals(): void {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('in');
        observer.unobserve(entry.target);
      }
    },
    { threshold: 0.15, rootMargin: '0px 0px -8% 0px' },
  );
  for (const element of document.querySelectorAll('[data-reveal]')) observer.observe(element);
}

function setUpNav(): void {
  const nav = document.querySelector<HTMLElement>('.nav');
  if (!nav) return;
  let frame = 0;
  const measure = () => {
    frame = 0;
    const travel = document.documentElement.scrollHeight - window.innerHeight;
    nav.classList.toggle('condensed', window.scrollY > 24);
    nav.style.setProperty('--read', travel > 0 ? (window.scrollY / travel).toFixed(4) : '0');
  };
  window.addEventListener(
    'scroll',
    () => {
      if (frame === 0) frame = requestAnimationFrame(measure);
    },
    { passive: true },
  );
  measure();
}

function setUpFlatten(): void {
  for (const element of document.querySelectorAll<HTMLElement>('[data-flatten]')) {
    scrollProgress(element, (progress) => {
      element.style.setProperty('--flat', Math.min(1, progress * 2.6).toFixed(3));
    });
  }
}

function track(element: HTMLElement, tilt: boolean): void {
  element.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch') return;
    const rect = element.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    element.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`);
    element.style.setProperty('--my', `${(y * 100).toFixed(1)}%`);
    if (!tilt) return;
    element.style.setProperty('--ry', `${((x - 0.5) * 7).toFixed(2)}deg`);
    element.style.setProperty('--rx', `${((0.5 - y) * 7).toFixed(2)}deg`);
  });
  element.addEventListener('pointerleave', () => {
    element.style.removeProperty('--rx');
    element.style.removeProperty('--ry');
  });
}

export function setUpEffects(still: boolean): void {
  setUpNav();
  if (still) return;
  document.documentElement.classList.add('motion');
  setUpReveals();
  setUpFlatten();
  for (const element of document.querySelectorAll<HTMLElement>('[data-tilt]')) track(element, true);
  for (const element of document.querySelectorAll<HTMLElement>('[data-spot]'))
    track(element, false);
}
