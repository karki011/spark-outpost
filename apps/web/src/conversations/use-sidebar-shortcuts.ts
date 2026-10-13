import { useEffect, type RefObject } from 'react';
import { isPaletteShortcut } from '../sessions/palette-model.ts';
import { isNewChatShortcut } from './SidebarHeader.tsx';

interface SidebarShortcuts {
  reveal: (() => void) | undefined;
  startNew: () => void;
  searchRef: RefObject<HTMLInputElement | null>;
}

export function useSidebarShortcuts({ reveal, startNew, searchRef }: SidebarShortcuts): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isNewChatShortcut(event)) {
        event.preventDefault();
        startNew();
        return;
      }
      if (isPaletteShortcut(event)) return;
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return;
      event.preventDefault();
      reveal?.();
      requestAnimationFrame(() => searchRef.current?.focus());
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [reveal, startNew, searchRef]);
}
