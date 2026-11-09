import { BROWSER_OUTSIDE_TARGET } from '@spark-outpost/contracts';
import { sparkDesktop } from '../desktop/desktop-bridge.ts';

const NEW_WINDOW = 'noopener,noreferrer';

export function outsideTarget(): string {
  return sparkDesktop() ? BROWSER_OUTSIDE_TARGET : '_blank';
}

export function openOutside(url: string): void {
  window.open(url, outsideTarget(), NEW_WINDOW);
}
