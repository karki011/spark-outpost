import { useSyncExternalStore } from 'react';

function subscribeVisibility(listener: () => void) {
  document.addEventListener('visibilitychange', listener);
  return () => document.removeEventListener('visibilitychange', listener);
}

export function usePageHidden(): boolean {
  return useSyncExternalStore(subscribeVisibility, () => document.visibilityState === 'hidden');
}
