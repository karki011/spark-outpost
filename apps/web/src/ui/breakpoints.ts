import { useEffect, useState } from 'react';

export const PHONE_QUERY = '(max-width: 640px), (max-height: 500px) and (pointer: coarse)';
export const DOCK_QUERY = '(min-width: 1101px)';
export const ROOMY_DOCK_QUERY = '(min-width: 1280px)';
export const TOUCH_QUERY = '(pointer: coarse)';

export function matchesMedia(query: string): boolean {
  return typeof matchMedia === 'function' && matchMedia(query).matches;
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => matchesMedia(query));
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const media = matchMedia(query);
    const onChange = () => setMatches(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

export function usePhone(): boolean {
  return useMediaQuery(PHONE_QUERY);
}
