import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

interface HeldFocus {
  chatId: string;
  control: string;
}

const CONTROLS = ['.rmenu', '.row-open'];

function heldBy(target: EventTarget | null): HeldFocus | null {
  if (!(target instanceof HTMLElement)) return null;
  const chatId = target.closest<HTMLElement>('[data-chat]')?.dataset.chat;
  const control = CONTROLS.find((selector) => target.matches(selector));
  return chatId && control ? { chatId, control } : null;
}

export function useRowFocus(listRef: RefObject<HTMLElement | null>, placement: string): void {
  const held = useRef<HeldFocus | null>(null);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const onFocusIn = (event: FocusEvent) => {
      held.current = heldBy(event.target);
    };
    const onFocusOut = (event: FocusEvent) => {
      if (event.relatedTarget) held.current = null;
    };
    list.addEventListener('focusin', onFocusIn);
    list.addEventListener('focusout', onFocusOut);
    return () => {
      list.removeEventListener('focusin', onFocusIn);
      list.removeEventListener('focusout', onFocusOut);
    };
  }, [listRef]);

  useLayoutEffect(() => {
    const lost = held.current;
    if (!lost || document.activeElement !== document.body) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-chat="${lost.chatId}"] ${lost.control}`)
      ?.focus();
  }, [placement, listRef]);
}
