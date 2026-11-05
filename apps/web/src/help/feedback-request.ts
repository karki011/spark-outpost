import { useEffect } from 'react';
import { requestSettings } from '../settings/settings-request.ts';

let pending = false;
const listeners = new Set<() => void>();

export function requestFeedback(): void {
  pending = true;
  requestSettings('help');
  for (const listener of listeners) listener();
}

export function useFeedbackFocus(focus: () => void): void {
  useEffect(() => {
    const take = () => {
      pending = false;
      requestAnimationFrame(focus);
    };
    if (pending) take();
    listeners.add(take);
    return () => {
      listeners.delete(take);
    };
  }, [focus]);
}
