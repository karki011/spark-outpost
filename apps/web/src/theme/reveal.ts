import { flushSync } from 'react-dom';
import { saveAppearance } from './appearance.ts';
import { inkReach, inkVariables, type Point } from './ink-mask.ts';
import type { Appearance } from './theme.ts';

const REVEAL_MS = 900;
const REVEAL_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

function revealOrigin(): Point {
  const focused = document.activeElement;
  const box =
    focused instanceof HTMLElement && focused !== document.body
      ? focused.getBoundingClientRect()
      : null;
  if (box && box.width > 0 && box.height > 0) {
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  }
  return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}

export function revealAppearance(next: Appearance, updateView: () => void = () => undefined): void {
  const commit = () => {
    flushSync(updateView);
    saveAppearance(next);
  };
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!document.startViewTransition || reduced) {
    commit();
    return;
  }
  const origin = revealOrigin();
  const root = document.documentElement;
  const variables = inkVariables(origin, Math.random() * 100);
  for (const [name, value] of Object.entries(variables)) root.style.setProperty(name, value);
  const reach = `${inkReach(origin, window.innerWidth, window.innerHeight).toFixed(1)}px`;
  const transition = document.startViewTransition(commit);
  void transition.ready.then(() => {
    root.animate(
      { '--ink-r': ['0px', reach], '--ink-d': [0, 1] },
      {
        duration: REVEAL_MS,
        easing: REVEAL_EASING,
        fill: 'forwards',
        pseudoElement: '::view-transition-new(root)',
      },
    );
  });
  void transition.finished.finally(() => {
    for (const name of Object.keys(variables)) root.style.removeProperty(name);
  });
}
