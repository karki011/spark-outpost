import type { RollupGroupBy, RollupRow } from '@spark-outpost/contracts';
import { turnCost, type TurnFact } from './facts.ts';
import { checkRollup, groupBy, outcomeTally, roundTo } from './tally.ts';

const KEYS: Record<RollupGroupBy, (fact: TurnFact) => string> = {
  day: (fact) => fact.day,
  project: (fact) => fact.project,
  provider: (fact) => fact.provider,
  model: (fact) => fact.modelLabel,
  category: (fact) => fact.category,
  jev_decision: (fact) => (fact.jevAnswered ? (fact.wouldApply ?? 'unknown') : 'no_jev'),
};

const sum = (facts: readonly TurnFact[], value: (fact: TurnFact) => number) =>
  facts.reduce((total, fact) => total + value(fact), 0);

export function rollupRow(key: string, facts: readonly TurnFact[]): RollupRow {
  const tally = outcomeTally(facts);
  const fixLoops = facts.filter((fact) => checkRollup(fact.checks)?.fixLoop === true).length;
  return {
    key,
    turns: tally.turns,
    runs: sum(facts, (fact) => fact.runs),
    costUsd: roundTo(sum(facts, turnCost), 6),
    reportedUsd: roundTo(
      sum(facts, (fact) => fact.reportedUsd),
      6,
    ),
    estimatedUsd: roundTo(
      sum(facts, (fact) => fact.estimatedUsd + fact.jevUsd),
      6,
    ),
    tokens: sum(facts, (fact) => fact.tokens),
    good: tally.good,
    bad: tally.bad,
    mixed: tally.mixed,
    unclear: tally.unclear,
    meanScore: tally.meanScore,
    kept: facts.filter((fact) => fact.kept).length,
    reverted: facts.filter((fact) => fact.reverted).length,
    corrections: facts.filter((fact) => fact.corrected).length,
    retries: sum(facts, (fact) => fact.retries) + fixLoops,
  };
}

export function rollups(facts: readonly TurnFact[], by: RollupGroupBy): RollupRow[] {
  const groups = groupBy(facts, KEYS[by]);
  const rows = [...groups.entries()].map(([key, group]) => rollupRow(key, group));
  return by === 'day'
    ? rows.sort((a, b) => a.key.localeCompare(b.key))
    : rows.sort((a, b) => b.costUsd - a.costUsd || b.turns - a.turns);
}
