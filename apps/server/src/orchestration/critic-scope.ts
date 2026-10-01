import type { FindingReading } from '../advisor/finding-questions.ts';
import { CRITIC_RECHECK_LINE_SLACK, CRITIC_SAME_CONCERN } from '../advisor/policy.ts';
import { normalizeFinding } from './review-loop.ts';

export type RecheckScope = 'earlier_note' | 'outside_fix';

export interface ScopedReading extends FindingReading {
  scope?: RecheckScope;
}

export interface RecheckFacts {
  previous: readonly string[];
  notes: readonly string[];
  fixPatch: string | null;
}

const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
const NEW_FILE = /^\+\+\+ (?:b\/)?(.+)$/;
const CITED = /([\w.@-]+(?:\/[\w.@-]+)*\.\w+)(?::(\d+))?/g;
const TAG = /^\W*\[(?:bug|missing|hardening|style|removed)\]\W*/i;
const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'then',
  'than',
  'are',
  'was',
  'can',
  'not',
  'but',
  'its',
  'into',
  'from',
  'when',
  'each',
  'every',
  'all',
  'one',
  'two',
  'still',
  'now',
  'after',
  'before',
  'should',
  'would',
  'could',
  'does',
  'only',
  'also',
  'these',
  'those',
]);

export function addedLines(patch: string): Map<string, number[]> {
  const files = new Map<string, number[]>();
  let current: number[] | null = null;
  let line = 0;
  for (const text of patch.split('\n')) {
    const file = NEW_FILE.exec(text);
    if (file) {
      current = file[1] === '/dev/null' ? null : [];
      if (current) files.set(file[1]!, current);
      continue;
    }
    const hunk = HUNK.exec(text);
    if (hunk) {
      line = Number(hunk[1]);
      continue;
    }
    if (!current || text.startsWith('---')) continue;
    if (text.startsWith('+')) current.push(line++);
    else if (!text.startsWith('-') && !text.startsWith('\\')) line++;
  }
  return files;
}

function stem(word: string): string {
  return word.replace(/(?:ing|ed|es|s)$/, '');
}

function concernWords(finding: string): Set<string> {
  const text = normalizeFinding(finding.replace(TAG, '').replace(CITED, ' '));
  return new Set(
    text
      .split(' ')
      .filter((word) => word.length >= 3 && !STOP_WORDS.has(word))
      .map(stem),
  );
}

export function sameConcern(a: string, b: string): boolean {
  const left = concernWords(a);
  const right = concernWords(b);
  const smaller = Math.min(left.size, right.size);
  if (smaller === 0) return false;
  const shared = [...left].filter((word) => right.has(word)).length;
  return shared / smaller >= CRITIC_SAME_CONCERN;
}

function pathMatches(cited: string, changed: string): boolean {
  return changed === cited || changed.endsWith(`/${cited}`);
}

export function insideFix(finding: string, fix: ReadonlyMap<string, readonly number[]>): boolean {
  const cited = [...finding.matchAll(CITED)].filter(
    ([, path, line]) => /\.[a-z]\w*$/i.test(path!) && (path!.includes('/') || line !== undefined),
  );
  if (cited.length === 0) return true;
  return cited.some(([, path, line]) => {
    const changed = [...fix.entries()].find(([file]) => pathMatches(path!, file))?.[1];
    if (!changed || changed.length === 0) return false;
    if (!line) return true;
    const at = Number(line);
    return changed.some((added) => Math.abs(added - at) <= CRITIC_RECHECK_LINE_SLACK);
  });
}

function scopeOf(finding: string, facts: RecheckFacts): RecheckScope | null {
  if (facts.previous.some((earlier) => sameConcern(earlier, finding))) return null;
  if (facts.notes.some((note) => sameConcern(note, finding))) return 'earlier_note';
  if (facts.fixPatch === null) return null;
  return insideFix(finding, addedLines(facts.fixPatch)) ? null : 'outside_fix';
}

export function scopeRecheck(
  readings: readonly FindingReading[],
  facts: RecheckFacts,
): ScopedReading[] {
  return readings.map((reading) => {
    if (!reading.correct) return reading;
    const scope = scopeOf(reading.finding, facts);
    if (!scope) return reading;
    return { ...reading, correct: false, kind: 'suggestion', by: 'rules', scope };
  });
}
