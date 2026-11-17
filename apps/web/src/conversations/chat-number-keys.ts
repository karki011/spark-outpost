import { createContext, useEffect, useRef, useState, type RefObject } from 'react';
import { MAC } from '../ui/shortcuts.ts';

const LAST = 9;
const HOLD_MS = 500;

export const ChatNumbers = createContext<ReadonlyMap<string, number> | null>(null);

type NumberChord = Pick<
  KeyboardEvent,
  'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'repeat' | 'isComposing'
> & { getModifierState: (key: string) => boolean };

export function chatNumber(event: NumberChord, mac: boolean): number | null {
  if (event.repeat || event.isComposing || event.shiftKey || event.altKey) return null;
  if (event.getModifierState('AltGraph')) return null;
  const modifier = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (!modifier) return null;
  const digit = /^Digit([1-9])$/.exec(event.code);
  return digit ? Number(digit[1]) : null;
}

export function chatAtNumber(ids: readonly string[], number: number): string | null {
  if (number === LAST) return ids.at(-1) ?? null;
  return ids[number - 1] ?? null;
}

export function chatNumbers(ids: readonly string[]): Map<string, number> {
  const numbers = new Map(ids.slice(0, LAST - 1).map((id, index) => [id, index + 1]));
  const last = ids.at(-1);
  if (ids.length >= LAST && last) numbers.set(last, LAST);
  return numbers;
}

export function listedChatIds(list: HTMLElement): string[] {
  const ids = [...list.querySelectorAll<HTMLElement>('[data-chat]')].flatMap((row) => {
    const folded = row.closest('[inert]');
    const shown = folded === null || !list.contains(folded);
    return shown && row.dataset.chat ? [row.dataset.chat] : [];
  });
  return [...new Set(ids)];
}

export function useChatNumberKeys(
  listRef: RefObject<HTMLElement | null>,
  onOpen: (id: string) => void,
): void {
  const latest = useRef(onOpen);
  useEffect(() => {
    latest.current = onOpen;
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const number = chatNumber(event, MAC);
      const list = listRef.current;
      if (number === null || !list) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      const id = chatAtNumber(listedChatIds(list), number);
      if (!id) return;
      event.preventDefault();
      latest.current(id);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [listRef]);
}

function isModifierAlone(event: KeyboardEvent, mac: boolean): boolean {
  if (event.repeat || event.shiftKey || event.altKey) return false;
  return mac ? event.key === 'Meta' && !event.ctrlKey : event.key === 'Control' && !event.metaKey;
}

export function useHeldChatNumbers(
  listRef: RefObject<HTMLElement | null>,
): ReadonlyMap<string, number> | null {
  const [numbers, setNumbers] = useState<ReadonlyMap<string, number> | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const hide = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      setNumbers(null);
    };
    const show = () => {
      timer = null;
      const list = listRef.current;
      if (!list || document.querySelector('[aria-modal="true"]')) return;
      setNumbers(chatNumbers(listedChatIds(list)));
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (isModifierAlone(event, MAC)) {
        if (timer === null) timer = setTimeout(show, HOLD_MS);
        return;
      }
      if (chatNumber(event, MAC) === null) hide();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === (MAC ? 'Meta' : 'Control')) hide();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', hide);
    return () => {
      if (timer !== null) clearTimeout(timer);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', hide);
    };
  }, [listRef]);
  return numbers;
}
