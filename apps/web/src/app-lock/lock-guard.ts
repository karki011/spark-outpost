import { wrapTabFocus } from '../ui/focus-trap.ts';

export const LOCK_HOST_CLASS = 'lock-host';

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled)';
const KEY_EVENTS = ['keydown', 'keyup', 'keypress'] as const;
const CLIPBOARD_EVENTS = ['paste', 'copy', 'cut'] as const;
const DRAG_EVENTS = ['dragenter', 'dragover', 'drop'] as const;

let covered = false;

function overlayFocusables(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(`.${LOCK_HOST_CLASS} :is(${FOCUSABLE})`)];
}

function keepFromApp(event: Event): void {
  if (!covered) return;
  event.stopImmediatePropagation();
  if (event instanceof KeyboardEvent && event.type === 'keydown') {
    wrapTabFocus(event, overlayFocusables);
  }
}

function refuseDrop(event: Event): void {
  if (!covered) return;
  event.stopImmediatePropagation();
  event.preventDefault();
}

export function installLockGuard(): void {
  for (const type of [...KEY_EVENTS, ...CLIPBOARD_EVENTS]) {
    window.addEventListener(type, keepFromApp, true);
  }
  for (const type of DRAG_EVENTS) window.addEventListener(type, refuseDrop, true);
}

export function coverPage(): () => void {
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const madeInert = new Set<HTMLElement>();
  const coverSiblings = () => {
    for (const child of document.body.children) {
      if (!(child instanceof HTMLElement)) continue;
      if (child.classList.contains(LOCK_HOST_CLASS) || child.inert) continue;
      child.inert = true;
      madeInert.add(child);
    }
  };
  covered = true;
  document.body.dataset.appLock = 'locked';
  coverSiblings();
  const observer = new MutationObserver(coverSiblings);
  observer.observe(document.body, { childList: true });
  return () => {
    observer.disconnect();
    covered = false;
    delete document.body.dataset.appLock;
    madeInert.forEach((child) => {
      child.inert = false;
    });
    if (focused?.isConnected) focused.focus();
  };
}
