import { useSyncExternalStore } from 'react';
import type { ColorScheme } from './guide-content.ts';

function readScheme(): ColorScheme {
  const scheme = getComputedStyle(document.documentElement).colorScheme;
  return scheme.includes('dark') && !scheme.includes('light') ? 'dark' : 'light';
}

let cached: ColorScheme | null = null;

function currentScheme(): ColorScheme {
  cached ??= readScheme();
  return cached;
}

function subscribe(onChange: () => void) {
  const refresh = () => {
    cached = null;
    onChange();
  };
  cached = null;
  const observer = new MutationObserver(refresh);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-skin'] });
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', refresh);
  return () => {
    observer.disconnect();
    media.removeEventListener('change', refresh);
  };
}

export function useColorScheme(): ColorScheme {
  return useSyncExternalStore(subscribe, currentScheme);
}
