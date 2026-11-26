import { useEffect } from 'react';

let pending = false;
const listeners = new Set<() => void>();

export function requestAddSpark(): void {
  pending = true;
  for (const listener of listeners) listener();
}

export function useAddSparkRequest(open: () => void): void {
  useEffect(() => {
    const take = () => {
      pending = false;
      open();
    };
    if (pending) take();
    listeners.add(take);
    return () => {
      listeners.delete(take);
    };
  }, [open]);
}
