export const PRESELECT_SCORE = 0.85;
export const PRESELECT_MARGIN = 0.1;
export const OFFER_SCORE = 0.6;
const OFFERED = 3;

export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aHits = new Array<boolean>(a.length).fill(false);
  const bHits = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i += 1) {
    const from = Math.max(0, i - window);
    const to = Math.min(b.length - 1, i + window);
    for (let j = from; j <= to; j += 1) {
      if (bHits[j] || a[i] !== b[j]) continue;
      aHits[i] = true;
      bHits[j] = true;
      matches += 1;
      break;
    }
  }
  if (matches === 0) return 0;
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (!aHits[i]) continue;
    while (!bHits[k]) k += 1;
    if (a[i] !== b[k]) transpositions += 1;
    k += 1;
  }
  const jaro =
    (matches / a.length + matches / b.length + (matches - transpositions / 2) / matches) / 3;
  let prefix = 0;
  while (prefix < 4 && a[prefix] !== undefined && a[prefix] === b[prefix]) prefix += 1;
  return jaro + prefix * 0.1 * (1 - jaro);
}

function bestTokenScore(token: string, against: readonly string[]): number {
  let best = 0;
  for (const other of against) best = Math.max(best, jaroWinkler(token, other));
  return best;
}

function directed(from: readonly string[], to: readonly string[]): number {
  if (from.length === 0) return 0;
  return from.reduce((sum, token) => sum + bestTokenScore(token, to), 0) / from.length;
}

export function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function similarity(heard: string, name: string): number {
  const a = words(heard);
  const b = words(name);
  if (a.length === 0 || b.length === 0) return 0;
  const tokenSet = Math.min(directed(a, b), directed(b, a));
  const left = a.join('');
  const right = b.join('');
  const lengths = Math.min(left.length, right.length) / Math.max(left.length, right.length);
  const joined = jaroWinkler(left, right) * Math.sqrt(lengths);
  return Math.max(tokenSet, joined);
}

export interface Named<T> {
  value: T;
  names: readonly string[];
}

export interface Ranked<T> {
  value: T;
  score: number;
}

export interface Matched<T> {
  heard: string;
  choices: Ranked<T>[];
  picked: T | null;
}

export function rank<T>(heard: string, candidates: readonly Named<T>[]): Matched<T> {
  const scored = candidates
    .map((candidate) => ({
      value: candidate.value,
      score: Math.max(0, ...candidate.names.map((name) => similarity(heard, name))),
    }))
    .sort((left, right) => right.score - left.score);
  const choices = scored.filter((entry) => entry.score >= OFFER_SCORE).slice(0, OFFERED);
  const [first, second] = scored;
  const clear =
    first !== undefined &&
    first.score >= PRESELECT_SCORE &&
    first.score - (second?.score ?? 0) >= PRESELECT_MARGIN;
  return { heard, choices, picked: clear ? first.value : null };
}
