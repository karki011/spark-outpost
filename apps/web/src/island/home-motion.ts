const LEAVE_MS = 260;

function playGhost(ghost: HTMLElement): void {
  const fade = ghost.animate(
    [
      { opacity: 1, transform: 'none' },
      { opacity: 0, transform: 'translateY(-12px) scale(0.94)' },
    ],
    { duration: LEAVE_MS, easing: 'cubic-bezier(0.5, 0, 0.9, 0.5)', fill: 'forwards' },
  );
  void fade.finished.catch(() => undefined).finally(() => ghost.remove());
}

const GHOST_ROW_LIMIT = 30;

export function leaveAsGhost(view: HTMLElement): void {
  const parent = view.parentElement;
  if (!parent || !view.isConnected || typeof view.animate !== 'function') return;
  if (
    view.querySelectorAll('[role="option"], [role="listitem"], li, button').length > GHOST_ROW_LIMIT
  )
    return;
  const ghost = view.cloneNode(true) as HTMLElement;
  ghost.querySelectorAll('[id]').forEach((element) => element.removeAttribute('id'));
  ghost.setAttribute('aria-hidden', 'true');
  ghost.inert = true;
  ghost.classList.add('isl-ghost');
  queueMicrotask(() => {
    if (view.isConnected || !parent.isConnected) return;
    parent.append(ghost);
    playGhost(ghost);
  });
}
