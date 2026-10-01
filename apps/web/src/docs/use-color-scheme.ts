import { useSyncExternalStore } from 'react';
import type { ColorScheme } from './guide-content.ts';

function currentScheme(): ColorScheme {
  const scheme = getComputedStyle(document.documentElement).colorScheme;
  return scheme.includes('dark') && !scheme.includes('light') ? 'dark' : 'light';
}

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-skin'] });
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', onChange);
  return () => {
    observer.disconnect();
    media.removeEventListener('change', onChange);
  };
}

export function useColorScheme(): ColorScheme {
  return useSyncExternalStore(subscribe, currentScheme);
}
