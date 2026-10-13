import { useEffect } from 'react';

const listeners = new Set<() => void>();

export function requestSessionPalette(): void {
  for (const listener of listeners) listener();
}

export function usePaletteRequests(open: () => void): void {
  useEffect(() => {
    listeners.add(open);
    return () => {
      listeners.delete(open);
    };
  }, [open]);
}
