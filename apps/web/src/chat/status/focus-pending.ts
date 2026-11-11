import { useEffect, useLayoutEffect, useRef } from 'react';
import { approvalAnchor } from '../../crew/conversation-crew.ts';
import { JUMP_TRIES, scrollToAnchor } from '../../crew/scroll-to-anchor.ts';
import type { PendingEntry } from './status-store.ts';

const FOCUSABLE =
  'textarea, input, button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';
const FOCUS_TRIES = 30;
const CHAT_PANE = '.cpane';

function focusCard(anchor: string, tries: number) {
  const card = document.getElementById(anchor);
  if (!card) {
    if (tries > 0) requestAnimationFrame(() => focusCard(anchor, tries - 1));
    return;
  }
  const target = card.querySelector<HTMLElement>(FOCUSABLE);
  target?.focus({ preventScroll: true });
}

export function focusCardFromNotification(id: string, tries = JUMP_TRIES): void {
  const card = document.getElementById(approvalAnchor(id));
  if (!card) {
    if (tries > 0) requestAnimationFrame(() => focusCardFromNotification(id, tries - 1));
    return;
  }
  if (!card.classList.contains('resolved')) focusPending(id);
}

export function focusPending(id: string): void {
  const anchor = approvalAnchor(id);
  scrollToAnchor(anchor);
  requestAnimationFrame(() => focusCard(anchor, FOCUS_TRIES));
}

function pendingCardHas(entries: readonly PendingEntry[], target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return entries.some((entry) =>
    document.getElementById(approvalAnchor(entry.id))?.contains(target),
  );
}

export function useFocusHandoff(entries: readonly PendingEntry[]): void {
  const hadFocus = useRef(false);
  const pane = useRef<ParentNode>(document);
  const shown = useRef<readonly PendingEntry[]>(entries);
  useEffect(() => {
    const onFocus = (event: FocusEvent) => {
      hadFocus.current = pendingCardHas(shown.current, event.target);
      if (hadFocus.current && event.target instanceof Element) {
        pane.current = event.target.closest(CHAT_PANE) ?? document;
      }
    };
    document.addEventListener('focusin', onFocus);
    return () => document.removeEventListener('focusin', onFocus);
  }, []);
  useLayoutEffect(() => {
    const before = shown.current;
    shown.current = entries;
    const left = before.some((entry) => !entries.some((now) => now.id === entry.id));
    if (!left || !hadFocus.current) return;
    const lost = document.activeElement === null || document.activeElement === document.body;
    if (!lost) return;
    hadFocus.current = false;
    const next = entries[0];
    if (next) {
      focusPending(next.id);
      return;
    }
    pane.current.querySelector<HTMLElement>('.composer textarea')?.focus({ preventScroll: true });
  }, [entries]);
}
