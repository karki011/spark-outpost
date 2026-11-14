import {
  CREW_SIMILAR_MAX,
  type CrewSimilar,
  type CrewSimilarReason,
} from '@spark-outpost/contracts';

const NEAR_NAME_MIN = 4;
const TYPO_NAME_MIN = 5;
const TYPO_DISTANCE_MAX = 2;
const SHARED_WORDS_MIN = 3;
const WORD_OVERLAP_MIN = 0.6;
const WORD_MIN = 4;

const COMMON_WORDS: ReadonlySet<string> = new Set([
  'this',
  'that',
  'with',
  'from',
  'when',
  'then',
  'into',
  'your',
  'their',
  'them',
  'each',
  'every',
  'user',
  'spark',
  'skill',
  'uses',
  'used',
]);

function squashed(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const swap = previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1);
      current.push(Math.min(previous[j]! + 1, current[j - 1]! + 1, swap));
    }
    previous = current;
  }
  return previous[b.length]!;
}

export function nameLikeness(a: string, b: string): 'same_name' | 'similar_name' | null {
  const [left, right] = [squashed(a), squashed(b)];
  if (left.length === 0 || right.length === 0) return null;
  if (left === right) return 'same_name';
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  if (shorter.length >= NEAR_NAME_MIN && longer.includes(shorter)) return 'similar_name';
  if (shorter.length >= TYPO_NAME_MIN && editDistance(left, right) <= TYPO_DISTANCE_MAX) {
    return 'similar_name';
  }
  return null;
}

function wordsOf(text: string): Set<string> {
  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return new Set(words.filter((word) => word.length >= WORD_MIN && !COMMON_WORDS.has(word)));
}

export function descriptionsAlike(a: string, b: string): boolean {
  const [left, right] = [wordsOf(a), wordsOf(b)];
  const shared = [...left].filter((word) => right.has(word)).length;
  if (shared < SHARED_WORDS_MIN) return false;
  return shared / Math.min(left.size, right.size) >= WORD_OVERLAP_MIN;
}

export interface CrewSubject {
  name: string;
  description: string;
}

export interface CrewCandidate extends CrewSubject {
  kind: CrewSimilar['kind'];
  spark: string | null;
}

const ORDER: Record<CrewSimilarReason, number> = {
  same_name: 0,
  similar_name: 1,
  similar_description: 2,
};

export function similarTo(
  subject: CrewSubject,
  candidates: readonly CrewCandidate[],
): CrewSimilar[] {
  const found: CrewSimilar[] = [];
  for (const candidate of candidates) {
    const reason =
      nameLikeness(subject.name, candidate.name) ??
      (descriptionsAlike(subject.description, candidate.description)
        ? 'similar_description'
        : null);
    if (reason) {
      found.push({ kind: candidate.kind, name: candidate.name, spark: candidate.spark, reason });
    }
  }
  return found.sort((a, b) => ORDER[a.reason] - ORDER[b.reason]).slice(0, CREW_SIMILAR_MAX);
}
