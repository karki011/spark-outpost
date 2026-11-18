import { appLockGate, type AppLockGate } from './app-lock-gate.ts';

export interface CoverableWindow {
  isDestroyed(): boolean;
  isVisible(): boolean;
  hide(): void;
  showInactive(): void;
  on(event: 'show' | 'closed', listener: () => void): unknown;
}

export function hideWhileLocked(window: CoverableWindow, gate: AppLockGate = appLockGate): void {
  let restore = false;
  const conceal = () => {
    if (window.isDestroyed() || !window.isVisible()) return;
    restore = true;
    window.hide();
  };
  const stop = gate.onLockedChange((locked) => {
    if (locked) conceal();
    else if (restore && !window.isDestroyed()) window.showInactive();
    if (!locked) restore = false;
  });
  window.on('show', () => {
    if (gate.locked()) conceal();
  });
  window.on('closed', stop);
  if (gate.locked()) conceal();
}
