import { useEffect } from 'react';
import { preloadTerminal } from '../terminal-connection.ts';

const IDLE_TIMEOUT_MS = 3000;
const FALLBACK_DELAY_MS = 1500;

let scheduled = false;

function load() {
  void preloadTerminal().catch(() => undefined);
}

function preloadWhenIdle() {
  if (scheduled) return;
  scheduled = true;
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(load, { timeout: IDLE_TIMEOUT_MS });
  } else {
    setTimeout(load, FALLBACK_DELAY_MS);
  }
}

export function useTerminalIdlePreload(enabled: boolean): void {
  useEffect(() => {
    if (enabled) preloadWhenIdle();
  }, [enabled]);
}
