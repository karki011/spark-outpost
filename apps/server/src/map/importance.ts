import type { Commit } from '../codescan/git.ts';
import { isTestFile } from '../codescan/test-pairs.ts';

export interface ImportanceInput {
  paths: readonly string[];
  fanIn: ReadonlyMap<string, number>;
  history: readonly Commit[];
  ownersOf: (path: string) => readonly string[];
}

export interface FileImportance {
  score: number;
  reasons: string[];
}

interface PathRule {
  pattern: RegExp;
  weight: number;
  reason: string;
}

const PATH_RULES: PathRule[] = [
  {
    pattern: /(?:^|\/)(?:auth|authn|authz|security|permissions?|sessions?)(?:\/|[-_.])/i,
    weight: 0.8,
    reason: 'auth',
  },
  { pattern: /(?:^|\/)(?:migrations?|db\/migrate)\//i, weight: 0.7, reason: 'migrations' },
  {
    pattern: /(?:^|\/)(?:schema|schemas|models?|entities)(?:\/|\.)/i,
    weight: 0.7,
    reason: 'schema',
  },
  {
    pattern: /(?:^|\/)(?:design-system|theme|tokens|ui-kit)(?:\/|\.)/i,
    weight: 0.6,
    reason: 'design system',
  },
  {
    pattern: /(?:^|\/)\.github\/workflows\/|(?:^|\/)\.gitlab-ci\.yml$|(?:^|\/)Jenkinsfile$/,
    weight: 0.5,
    reason: 'CI',
  },
  {
    pattern: /(?:^|\/)(?:payments?|billing|checkout)(?:\/|[-_.])/i,
    weight: 0.6,
    reason: 'payments',
  },
  {
    pattern: /(?:^|\/)(?:src\/)?(?:main|index|app|server)\.[cm]?[jt]sx?$|(?:^|\/)main\.(?:go|py)$/,
    weight: 0.6,
    reason: 'entry point',
  },
  {
    pattern: /(?:^|\/)(?:package\.json|tsconfig\.json|Dockerfile|go\.mod|pyproject\.toml)$/,
    weight: 0.4,
    reason: 'build config',
  },
];

const WEIGHTS = { fanIn: 0.35, churn: 0.2, authors: 0.1, owners: 0.1, path: 0.15, age: 0.1 };

function logShare(value: number, largest: number): number {
  return largest > 0 ? Math.log1p(value) / Math.log1p(largest) : 0;
}

interface Touches {
  count: number;
  first: number;
  authors: Set<string>;
}

function touchesByFile(history: readonly Commit[]): Map<string, Touches> {
  const touches = new Map<string, Touches>();
  for (const commit of history) {
    for (const path of commit.files) {
      const entry = touches.get(path) ?? { count: 0, first: commit.at, authors: new Set<string>() };
      entry.count += 1;
      entry.first = Math.min(entry.first, commit.at);
      if (commit.author) entry.authors.add(commit.author);
      touches.set(path, entry);
    }
  }
  return touches;
}

function largest(values: Iterable<number>): number {
  let max = 0;
  for (const value of values) if (value > max) max = value;
  return max;
}

export function pathWeight(path: string): { weight: number; reasons: string[] } {
  const matched = PATH_RULES.filter((rule) => rule.pattern.test(path));
  return {
    weight: largest(matched.map((rule) => rule.weight)),
    reasons: matched.map((rule) => rule.reason),
  };
}

export function scoreImportance(input: ImportanceInput): Map<string, FileImportance> {
  const touches = touchesByFile(input.history);
  const maxFanIn = largest(input.fanIn.values());
  const maxChurn = largest([...touches.values()].map((entry) => entry.count));
  const maxAuthors = largest([...touches.values()].map((entry) => entry.authors.size));
  const times = input.history.map((commit) => commit.at);
  const oldest = times.length > 0 ? Math.min(...times) : 0;
  const newest = times.length > 0 ? Math.max(...times) : 0;
  const span = Math.max(1, newest - oldest);
  const scores = new Map<string, FileImportance>();
  for (const path of input.paths) {
    const fanIn = input.fanIn.get(path) ?? 0;
    const touch = touches.get(path);
    const owners = input.ownersOf(path);
    const byPath = pathWeight(path);
    const age = touch ? (newest - touch.first) / span : 1;
    const raw =
      WEIGHTS.fanIn * logShare(fanIn, maxFanIn) +
      WEIGHTS.churn * logShare(touch?.count ?? 0, maxChurn) +
      WEIGHTS.authors * logShare(touch?.authors.size ?? 0, maxAuthors) +
      WEIGHTS.owners * (owners.length > 0 ? 1 : 0) +
      WEIGHTS.path * byPath.weight +
      WEIGHTS.age * age;
    const reasons = [...byPath.reasons];
    if (fanIn > 0) reasons.unshift(`imported by ${fanIn}`);
    if (touch && touch.count > 1) reasons.push(`changed ${touch.count} times`);
    if (touch && touch.authors.size > 1) reasons.push(`${touch.authors.size} authors`);
    if (owners.length > 0) reasons.push('code owners');
    const score = isTestFile(path) ? raw * 0.5 : raw;
    scores.set(path, { score: Math.round(score * 1000) / 1000, reasons });
  }
  return scores;
}
