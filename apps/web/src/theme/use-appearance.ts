import { useSyncExternalStore } from 'react';
import { onAppearanceChange, readAppearance } from './appearance.ts';
import { formatAppearance, type Appearance } from './theme.ts';

let cached: Appearance | null = null;

function currentAppearance(): Appearance {
  const next = readAppearance();
  if (!cached || formatAppearance(cached) !== formatAppearance(next)) cached = next;
  return cached;
}

export function useAppearance(): Appearance {
  return useSyncExternalStore(onAppearanceChange, currentAppearance);
}

export function withChange(patch: Partial<Appearance>): Appearance {
  return { ...readAppearance(), ...patch };
}
