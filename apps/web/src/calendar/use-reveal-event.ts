import { useEffect } from 'react';

const PULSE_MS = 1_400;

export function useRevealEvent(eventKey: string | null, flash: number, ready: boolean): void {
  useEffect(() => {
    if (!eventKey || flash === 0 || !ready) return;
    const block = document.querySelector<HTMLElement>(`[data-event-key="${CSS.escape(eventKey)}"]`);
    if (!block) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    block.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
    block.dataset.pulse = 'true';
    const timer = window.setTimeout(() => delete block.dataset.pulse, PULSE_MS);
    return () => {
      window.clearTimeout(timer);
      delete block.dataset.pulse;
    };
  }, [eventKey, flash, ready]);
}
