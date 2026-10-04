import { findSparkMentions } from '@spark-outpost/contracts';

export interface MatchableSpark {
  id: string;
  name: string;
  role: string;
  instructions: string;
}

const CONCEPT_WORDS: Record<string, readonly string[]> = {
  review: ['review', 'reviewer', 'critique', 'feedback'],
  docs: ['doc', 'docs', 'documentation', 'document', 'readme', 'changelog'],
  bug: ['bug', 'fix', 'debug', 'crash', 'regression'],
  test: ['test', 'tester', 'qa', 'coverage'],
  design: ['design', 'designer', 'ui', 'ux'],
  security: ['security', 'secure', 'vulnerability'],
  refactor: ['refactor', 'cleanup', 'simplify'],
  plan: ['plan', 'planner', 'architect', 'architecture'],
};

const GENERIC_ROLE_WORDS = [
  'code',
  'writer',
  'helper',
  'engineer',
  'expert',
  'assistant',
  'spark',
  'senior',
  'junior',
  'lead',
  'agent',
  'developer',
  'with',
  'from',
  'that',
  'this',
  'your',
];

const NAME_SCORE = 3;
const CONCEPT_SCORE = 2;
const ROLE_WORD_SCORE = 1;
const SUGGEST_AT = 2;
const MIN_DRAFT_WORDS = 2;
const MIN_NAME_LENGTH = 3;
const MIN_ROLE_WORD_LENGTH = 4;
const SUFFIXES = ['ing', 'ers', 'er', 'ed', 'es'];

export function stem(word: string): string {
  let base = word.toLowerCase();
  const suffix = base.length > 4 ? SUFFIXES.find((ending) => base.endsWith(ending)) : undefined;
  if (suffix) base = base.slice(0, -suffix.length);
  else if (base.length > 3 && base.endsWith('s') && !base.endsWith('ss')) base = base.slice(0, -1);
  if (base.length > 3 && base.at(-1) === base.at(-2) && !/[aeiou]/.test(base.at(-1)!)) {
    base = base.slice(0, -1);
  }
  return base.length > 3 && base.endsWith('e') ? base.slice(0, -1) : base;
}

const CONCEPT_OF = new Map(
  Object.entries(CONCEPT_WORDS).flatMap(([concept, words]) =>
    words.map((word) => [stem(word), concept] as const),
  ),
);
const GENERIC = new Set(GENERIC_ROLE_WORDS.map(stem));

function stems(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}+#]+/gu) ?? []).map(stem);
}

function conceptsOf(spark: MatchableSpark): Set<string> {
  const fromRole = stems(spark.role).flatMap((word) => CONCEPT_OF.get(word) ?? []);
  if (fromRole.length > 0) return new Set(fromRole);
  const leading = stems(spark.instructions).find((word) => CONCEPT_OF.has(word));
  return new Set(leading ? [CONCEPT_OF.get(leading)!] : []);
}

function roleWords(spark: MatchableSpark): Set<string> {
  return new Set(
    stems(spark.role).filter(
      (word) => word.length >= MIN_ROLE_WORD_LENGTH && !GENERIC.has(word) && !CONCEPT_OF.has(word),
    ),
  );
}

function namePosition(draft: string, name: string): number {
  const wanted = name.trim().toLowerCase();
  if (wanted.length < MIN_NAME_LENGTH) return -1;
  const lower = draft.toLowerCase();
  for (let at = lower.indexOf(wanted); at !== -1; at = lower.indexOf(wanted, at + 1)) {
    const before = lower.charAt(at - 1);
    const after = lower.charAt(at + wanted.length);
    if (!/[\p{L}\p{N}@]/u.test(before) && !/[\p{L}\p{N}]/u.test(after)) return at;
  }
  return -1;
}

interface Scored {
  score: number;
  first: number;
}

function scoreSpark(draft: string, words: readonly string[], spark: MatchableSpark): Scored {
  const concepts = conceptsOf(spark);
  const role = roleWords(spark);
  const counted = new Set<string>();
  let score = 0;
  let first = Number.POSITIVE_INFINITY;
  const named = namePosition(draft, spark.name);
  if (named !== -1) {
    score += NAME_SCORE;
    first = -1;
  }
  words.forEach((word, index) => {
    const concept = CONCEPT_OF.get(word);
    const key = concept && concepts.has(concept) ? `concept:${concept}` : `word:${word}`;
    const worth = key.startsWith('concept:') ? CONCEPT_SCORE : role.has(word) ? ROLE_WORD_SCORE : 0;
    if (worth === 0 || counted.has(key)) return;
    counted.add(key);
    score += worth;
    first = Math.min(first, index);
  });
  return { score, first };
}

export function suggestSpark<T extends MatchableSpark>(
  draft: string,
  sparks: readonly T[],
): T | null {
  const text = draft.trim();
  if (!text || text.startsWith('/') || findSparkMentions(text, sparks).length > 0) return null;
  const words = stems(text);
  if (words.length < MIN_DRAFT_WORDS) return null;
  let best: { spark: T; scored: Scored } | null = null;
  for (const spark of sparks) {
    const scored = scoreSpark(text, words, spark);
    if (scored.score < SUGGEST_AT) continue;
    const better =
      !best ||
      scored.score > best.scored.score ||
      (scored.score === best.scored.score && scored.first < best.scored.first);
    if (better) best = { spark, scored };
  }
  return best?.spark ?? null;
}
