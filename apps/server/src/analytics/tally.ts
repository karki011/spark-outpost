import type { OutcomeTally, VerdictCounts } from '@spark-outpost/contracts';
import type { CheckFact, TurnFact } from './facts.ts';

export function emptyVerdicts(): VerdictCounts {
  return { good: 0, bad: 0, mixed: 0, unclear: 0 };
}

export function roundTo(value: number, places = 3): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function quantile(values: readonly number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower);
}

export function outcomeTally(facts: readonly TurnFact[]): OutcomeTally {
  const verdicts = emptyVerdicts();
  const scores: number[] = [];
  for (const fact of facts) {
    if (fact.verdict) verdicts[fact.verdict] += 1;
    if (fact.score !== null) scores.push(fact.score);
  }
  const average = mean(scores);
  return {
    ...verdicts,
    turns: facts.length,
    meanScore: average === null ? null : roundTo(average),
  };
}

export function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const name = key(item);
    const group = groups.get(name);
    if (group) group.push(item);
    else groups.set(name, [item]);
  }
  return groups;
}

export interface CheckRollup {
  firstPassed: boolean;
  finalPassed: boolean;
  fixLoop: boolean;
  rounds: number;
}

export function checkRollup(checks: readonly CheckFact[]): CheckRollup | null {
  const counted = checks.filter((check) => check.status !== 'skipped');
  if (counted.length === 0) return null;
  const firstRound = counted.filter((check) => check.round === 1);
  const latest = new Map<string, CheckFact>();
  for (const check of counted) latest.set(check.key, check);
  return {
    firstPassed: firstRound.length > 0 && firstRound.every((check) => check.status === 'passed'),
    finalPassed: [...latest.values()].every((check) => check.status === 'passed'),
    fixLoop: counted.some((check) => check.round > 1),
    rounds: counted.length,
  };
}
