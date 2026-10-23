import { useEffect } from 'react';

const BUSY_PLACES = '[role="dialog"], [role="menu"], [role="listbox"], .appr';
const COMPOSER_INPUT = '.composer textarea';
const THREAD = '.thread';
const TYPING = 'input, textarea, select, [contenteditable="true"]';

export function stopsOnEscape(event: KeyboardEvent): boolean {
  if (event.key !== 'Escape' || event.defaultPrevented || event.repeat) return false;
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false;
  const target = event.target instanceof Element ? event.target : null;
  if (!target || target === document.body) return true;
  if (target.closest(BUSY_PLACES)) return false;
  if (target.matches(COMPOSER_INPUT)) return true;
  return Boolean(target.closest(THREAD)) && !target.closest(TYPING);
}

export function useEscapeStop(running: boolean, stop: () => void): void {
  useEffect(() => {
    if (!running) return;
    const onKey = (event: KeyboardEvent) => {
      if (!stopsOnEscape(event)) return;
      event.preventDefault();
      stop();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [running, stop]);
}
