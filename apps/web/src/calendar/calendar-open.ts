import { useEffect } from 'react';
import { requestSettings } from '../settings/settings-request.ts';

let pending = false;
const listeners = new Set<() => void>();

export function openCalendarCard(): void {
  pending = true;
  requestSettings('tools');
  listeners.forEach((listener) => listener());
}

export function takeCalendarCardRequest(): boolean {
  const asked = pending;
  pending = false;
  return asked;
}

export function useCalendarCardRequests(open: () => void): void {
  useEffect(() => {
    const take = () => {
      if (takeCalendarCardRequest()) open();
    };
    listeners.add(take);
    return () => {
      listeners.delete(take);
    };
  }, [open]);
}
