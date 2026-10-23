import { useEffect, type KeyboardEvent } from 'react';
import { wrapTabFocus } from '../../ui/focus-trap.ts';

const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]):not([hidden]), textarea, [tabindex]:not([tabindex="-1"])';

interface SheetKeys {
  discarding: boolean;
  onKeep: () => void;
  onClose: () => void;
  onPrimary: () => void;
  onEnterInField: () => void;
}

function shown(panel: HTMLElement): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => !element.closest('[hidden]'),
  );
}

function typedInField(event: KeyboardEvent): boolean {
  return event.target instanceof HTMLInputElement && event.target.type !== 'file';
}

export function useReturnFocus(): void {
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => opener?.focus();
  }, []);
}

export function sheetKeys(keys: SheetKeys) {
  return (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && !event.defaultPrevented) {
      event.stopPropagation();
      if (keys.discarding) keys.onKeep();
      else keys.onClose();
      return;
    }
    if (event.key === 'Enter' && !event.nativeEvent.isComposing && !event.defaultPrevented) {
      const commanded = event.metaKey || event.ctrlKey;
      if (commanded || typedInField(event)) {
        event.preventDefault();
        if (commanded) keys.onPrimary();
        else keys.onEnterInField();
        return;
      }
    }
    const panel = event.currentTarget;
    wrapTabFocus(event, () => shown(panel));
  };
}
