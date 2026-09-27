import { useSyncExternalStore } from 'react';
import { CORNERS, type Corner } from './companion-model.ts';

export interface CompanionPrefs {
  corner: Corner;
  hidden: boolean;
  seenErrors: readonly string[];
}

const STORAGE_KEY = 'spark-outpost.companion';
export const SEEN_ERRORS_LIMIT = 50;

const DEFAULT_PREFS: CompanionPrefs = { corner: 'bottom-right', hidden: false, seenErrors: [] };

export function parsePrefs(raw: string | null): CompanionPrefs {
  if (!raw) return DEFAULT_PREFS;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const seen = Array.isArray(value.seenErrors)
      ? value.seenErrors.filter((entry): entry is string => typeof entry === 'string')
      : [];
    return {
      corner: CORNERS.includes(value.corner as Corner) ? (value.corner as Corner) : 'bottom-right',
      hidden: value.hidden === true,
      seenErrors: seen.slice(-SEEN_ERRORS_LIMIT),
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function withSeenErrors(current: readonly string[], keys: readonly string[]): string[] {
  const fresh = keys.filter((key) => !current.includes(key));
  return [...current, ...fresh].slice(-SEEN_ERRORS_LIMIT);
}

function readPrefs(): CompanionPrefs {
  try {
    return parsePrefs(localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_PREFS;
  }
}

function writePrefs(next: CompanionPrefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    return;
  }
}

let prefs: CompanionPrefs = readPrefs();
const listeners = new Set<() => void>();

function update(next: Partial<CompanionPrefs>) {
  prefs = { ...prefs, ...next };
  writePrefs(prefs);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useCompanionPrefs(): CompanionPrefs {
  return useSyncExternalStore(subscribe, () => prefs);
}

export const companionPrefs = {
  setCorner: (corner: Corner) => update({ corner }),
  setHidden: (hidden: boolean) => update({ hidden }),
  markErrorsSeen: (keys: readonly string[]) => {
    const seenErrors = withSeenErrors(prefs.seenErrors, keys);
    if (keys.some((key) => !prefs.seenErrors.includes(key))) update({ seenErrors });
  },
};
