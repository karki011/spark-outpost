import { matchesMedia, TOUCH_QUERY } from '../ui/breakpoints.ts';

const KEYBOARD_MIN_HEIGHT = 120;
const TEXT_INPUT_TYPES = new Set([
  '',
  'text',
  'search',
  'email',
  'url',
  'tel',
  'password',
  'number',
]);

function takesText(target: Element | null): boolean {
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(target.type);
  return target instanceof HTMLElement && target.isContentEditable;
}

export function keyboardCovers(tallest: number, visible: number): boolean {
  return tallest - visible > KEYBOARD_MIN_HEIGHT;
}

export function startTouchViewport(): void {
  const viewport = window.visualViewport;
  if (!viewport || !matchesMedia(TOUCH_QUERY)) return;
  const root = document.documentElement;
  let width = window.innerWidth;
  let tallest = viewport.height;
  const fit = () => {
    if (window.innerWidth !== width) {
      width = window.innerWidth;
      tallest = viewport.height;
    }
    tallest = Math.max(tallest, viewport.height);
    const typing = keyboardCovers(tallest, viewport.height) && takesText(document.activeElement);
    root.toggleAttribute('data-typing', typing);
    if (typing) {
      root.style.setProperty('--viewport-h', `${Math.round(viewport.height)}px`);
      window.scrollTo(0, 0);
    } else {
      root.style.removeProperty('--viewport-h');
    }
  };
  viewport.addEventListener('resize', fit);
  document.addEventListener('focusin', fit);
  document.addEventListener('focusout', () => requestAnimationFrame(fit));
}
