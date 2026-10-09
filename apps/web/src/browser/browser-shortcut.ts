import { useEffect } from 'react';
import { MAC } from '../ui/shortcuts.ts';

function isBrowserShortcut(event: KeyboardEvent): boolean {
  const modifier = MAC ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  return modifier && event.shiftKey && !event.altKey && event.code === 'KeyB';
}

export function useBrowserShortcut(onToggle: (() => void) | null) {
  useEffect(() => {
    if (!onToggle) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isBrowserShortcut(event)) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault();
      event.stopPropagation();
      onToggle();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onToggle]);
}
