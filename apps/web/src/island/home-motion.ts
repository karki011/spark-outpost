const HOP_MS = 680;
const LEAVE_MS = 260;
const TICK_MS = 340;

function easing(element: Element, name: string, fallback: string): string {
  return getComputedStyle(element).getPropertyValue(name).trim() || fallback;
}

function centerDelta(from: DOMRect, to: DOMRect): { x: number; y: number } {
  return {
    x: from.left + from.width / 2 - (to.left + to.width / 2),
    y: from.top + from.height / 2 - (to.top + to.height / 2),
  };
}

function hopOrigin(chatId: string | null): DOMRect | null {
  const peeking = chatId
    ? document.querySelector<HTMLElement>(`.isl-peekblob[data-chat="${chatId}"]`)
    : null;
  const origin = peeking ?? document.querySelector<HTMLElement>('.isl-scout-wrap');
  const rect = origin?.getBoundingClientRect();
  return rect && rect.width > 0 ? rect : null;
}

export function hopIn(blob: HTMLElement, chatId: string | null): void {
  const origin = hopOrigin(chatId);
  if (!origin || typeof blob.animate !== 'function') return;
  const final = blob.getBoundingClientRect();
  const delta = centerDelta(origin, final);
  const scale = Math.min(1, Math.max(0.2, origin.width / final.width));
  blob.animate(
    [
      { transform: `translate(${delta.x}px, ${delta.y}px) scale(${scale})`, opacity: 0.4 },
      { transform: 'none', opacity: 1 },
    ],
    { duration: HOP_MS, easing: easing(blob, '--spring-pop', 'ease-out'), fill: 'backwards' },
  );
}

export function tickUp(list: HTMLElement, lineHeight: number): void {
  if (typeof list.animate !== 'function') return;
  list.animate([{ transform: `translateY(${lineHeight}px)` }, { transform: 'none' }], {
    duration: TICK_MS,
    easing: easing(list, '--spring-soft', 'ease-out'),
  });
}

function restPoint(view: HTMLElement): DOMRect {
  const island = view.closest('.isl')?.getBoundingClientRect();
  const x = island ? island.left + island.width / 2 : window.innerWidth / 2;
  return new DOMRect(x - 12, 0, 24, 24);
}

function playGhost(ghost: HTMLElement, blobFrom: DOMRect | null, rest: DOMRect): void {
  const fade = ghost.animate(
    [
      { opacity: 1, transform: 'none' },
      { opacity: 0, transform: 'translateY(-12px) scale(0.94)' },
    ],
    { duration: LEAVE_MS, easing: 'cubic-bezier(0.5, 0, 0.9, 0.5)', fill: 'forwards' },
  );
  const blob = ghost.querySelector<HTMLElement>('.isl-now-blob');
  if (blob && blobFrom) {
    const delta = centerDelta(rest, blobFrom);
    blob.animate(
      [{ transform: 'none' }, { transform: `translate(${delta.x}px, ${delta.y}px) scale(0.3)` }],
      { duration: LEAVE_MS, easing: 'cubic-bezier(0.5, 0, 0.75, 0)', fill: 'forwards' },
    );
  }
  void fade.finished.catch(() => undefined).finally(() => ghost.remove());
}

export function leaveAsGhost(view: HTMLElement): void {
  const parent = view.parentElement;
  if (!parent || !view.isConnected || typeof view.animate !== 'function') return;
  const ghost = view.cloneNode(true) as HTMLElement;
  ghost.querySelectorAll('[id]').forEach((element) => element.removeAttribute('id'));
  ghost.setAttribute('aria-hidden', 'true');
  ghost.inert = true;
  ghost.classList.add('isl-ghost');
  const blobFrom = view.querySelector('.isl-now-blob')?.getBoundingClientRect() ?? null;
  const rest = restPoint(view);
  queueMicrotask(() => {
    if (view.isConnected || !parent.isConnected) return;
    parent.append(ghost);
    playGhost(ghost, blobFrom, rest);
  });
}
