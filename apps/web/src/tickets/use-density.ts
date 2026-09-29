import { useCallback, useState } from 'react';

export type Density = 'comfortable' | 'compact';

const DENSITY_KEY = 'spark-outpost.tickets.density';

function readDensity(): Density {
  try {
    return localStorage.getItem(DENSITY_KEY) === 'compact' ? 'compact' : 'comfortable';
  } catch {
    return 'comfortable';
  }
}

export function useDensity() {
  const [density, setDensityState] = useState<Density>(readDensity);
  const setDensity = useCallback((next: Density) => {
    setDensityState(next);
    try {
      localStorage.setItem(DENSITY_KEY, next);
    } catch {
      return;
    }
  }, []);
  return [density, setDensity] as const;
}
