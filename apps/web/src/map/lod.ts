import { FIRST_PAGE } from './map-api.ts';

export const LOAD_FIRST_PX = 26;
export const LOAD_ALL_PX = 240;
export const STAR_NAMES_PX = 180;
const DENSITY = 0.045;

export function wantedFiles(screenRadius: number, fileCount: number): number {
  if (screenRadius < LOAD_FIRST_PX) return 0;
  if (screenRadius < LOAD_ALL_PX || fileCount <= FIRST_PAGE) return Math.min(fileCount, FIRST_PAGE);
  return fileCount;
}

export function drawBudget(screenRadius: number, loaded: number): number {
  const budget = Math.ceil(screenRadius * screenRadius * DENSITY);
  return Math.min(loaded, Math.max(12, budget));
}

export interface LoadCandidate {
  key: string;
  screenRadius: number;
  fileCount: number;
  loaded: number;
  visible: boolean;
}

export interface LoadRequest {
  key: string;
  limit: number;
}

export function loadRequests(
  candidates: readonly LoadCandidate[],
  inFlight: ReadonlySet<string>,
  slots: number,
): LoadRequest[] {
  return candidates
    .filter((c) => c.visible && !inFlight.has(c.key))
    .map((c) => ({ c, limit: wantedFiles(c.screenRadius, c.fileCount) }))
    .filter(({ c, limit }) => limit > c.loaded)
    .sort((a, b) => b.c.screenRadius - a.c.screenRadius)
    .slice(0, Math.max(0, slots))
    .map(({ c, limit }) => ({ key: c.key, limit }));
}

export function placeholderStars(seed: string, count: number, radius: number): [number, number][] {
  let state = 0;
  for (let i = 0; i < seed.length; i += 1) state = (state * 31 + seed.charCodeAt(i)) >>> 0;
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  return Array.from({ length: count }, () => {
    const angle = next() * Math.PI * 2;
    const distance = Math.sqrt(next()) * radius;
    return [Math.cos(angle) * distance, Math.sin(angle) * distance * 0.9];
  });
}
