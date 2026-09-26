import { flushSync } from 'react-dom';
import { applyTheme, type ThemeId } from './theme.ts';

const REVEAL_MS = 650;

export function revealTheme(id: ThemeId, updateView: () => void = () => undefined): void {
  const commit = () => {
    flushSync(updateView);
    applyTheme(id);
  };
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!document.startViewTransition || reduced) {
    commit();
    return;
  }
  const x = window.innerWidth / 2;
  const y = window.innerHeight / 2;
  const radius = Math.hypot(x, y);
  const transition = document.startViewTransition(commit);
  void transition.ready.then(() => {
    document.documentElement.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
      {
        duration: REVEAL_MS,
        easing: 'cubic-bezier(0.65, 0, 0.35, 1)',
        pseudoElement: '::view-transition-new(root)',
      },
    );
  });
}
