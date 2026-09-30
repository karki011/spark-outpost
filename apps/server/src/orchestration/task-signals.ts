import { RATING_KEYS, type RatingKey, type Ratings } from '@spark-outpost/contracts';
import { RATING_ACT_AT, TRIVIAL_OVERRIDE_AT } from '../advisor/policy.ts';
import type { ComplexSignal } from './builder-complexity.ts';

export type SignalSource = 'jev' | 'rules';

export interface Signal {
  value: number;
  source: SignalSource;
}

export type TaskSignals = Record<RatingKey, Signal>;

export interface RuleFacts {
  trivial: boolean;
  destructive: boolean;
  complex: ComplexSignal | null;
  vague?: boolean;
  continues?: boolean | null;
}

const HIGH_STAKES = new Set(['migration', 'security']);

const rule = (value: number): Signal => ({ value, source: 'rules' });

function ruleComplexity(facts: RuleFacts): number {
  if (facts.complex) return 4;
  return facts.trivial ? 1 : 2;
}

function ruleStakes(facts: RuleFacts): number {
  if (facts.destructive) return 5;
  if (facts.complex && HIGH_STAKES.has(facts.complex.reason)) return 4;
  return facts.trivial ? 1 : 2;
}

export function ruleSignals(facts: RuleFacts): TaskSignals {
  return {
    complexity: rule(ruleComplexity(facts)),
    ambiguity: rule(facts.vague ? 3 : 2),
    stakes: rule(ruleStakes(facts)),
    contextDependence: rule(facts.continues ? 4 : 2),
  };
}

const SIZE_KEYS: ReadonlySet<RatingKey> = new Set(['complexity', 'stakes']);

function ruleFloor(key: RatingKey, rules: TaskSignals, facts: RuleFacts): number {
  if (key === 'complexity' && facts.complex) return rules.complexity.value;
  if (key === 'stakes' && rules.stakes.value >= 4) return rules.stakes.value;
  if (facts.trivial && SIZE_KEYS.has(key)) return TRIVIAL_OVERRIDE_AT;
  return 1;
}

export function taskSignals(facts: RuleFacts, ratings: Ratings | null | undefined): TaskSignals {
  const rules = ruleSignals(facts);
  const signals = { ...rules };
  for (const key of RATING_KEYS) {
    const rating = ratings?.[key];
    if (!rating || rating.confidence < RATING_ACT_AT) continue;
    if (rating.value < ruleFloor(key, rules, facts)) continue;
    signals[key] = { value: rating.value, source: 'jev' };
  }
  return signals;
}

const SHORT: Readonly<Record<RatingKey, string>> = {
  complexity: 'complexity',
  ambiguity: 'ambiguity',
  stakes: 'stakes',
  contextDependence: 'context',
};

export function signalText(signals: TaskSignals): string {
  return RATING_KEYS.map((key) => {
    const signal = signals[key];
    return `${SHORT[key]} ${signal.value}${signal.source === 'jev' ? ' (Jev)' : ''}`;
  }).join(', ');
}
