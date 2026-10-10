import type { ApprovalWaits, CheckSummary, LoopSummary } from '@spark-outpost/contracts';
import type { TurnFact } from './facts.ts';
import { checkRollup, groupBy, quantile } from './tally.ts';

export function checkSummary(facts: readonly TurnFact[]): CheckSummary {
  const rollups = facts.flatMap((fact) => {
    const rollup = checkRollup(fact.checks);
    return rollup ? [rollup] : [];
  });
  return {
    turns: rollups.length,
    firstPassed: rollups.filter((rollup) => rollup.firstPassed).length,
    finalPassed: rollups.filter((rollup) => rollup.finalPassed).length,
    fixLoops: rollups.filter((rollup) => rollup.fixLoop).length,
    rounds: rollups.reduce((sum, rollup) => sum + rollup.rounds, 0),
  };
}

export function loopSummary(facts: readonly TurnFact[]): LoopSummary {
  const orchestrated = facts.filter((fact) => fact.roles.length > 0);
  const fixLoop = (fact: TurnFact) => checkRollup(fact.checks)?.fixLoop === true;
  return {
    turns: orchestrated.length,
    withRetries: orchestrated.filter((fact) => fact.retries > 0 || fixLoop(fact)).length,
    retries: orchestrated.reduce((sum, fact) => sum + fact.retries, 0),
    fixLoops: orchestrated.filter(fixLoop).length,
  };
}

export interface WaitSample {
  kind: string;
  waitMs: number;
}

const wholeMs = (value: number | null) => (value === null ? null : Math.round(value));

export function waitSummary(samples: readonly WaitSample[]): ApprovalWaits {
  const byKind = [...groupBy(samples, (sample) => sample.kind).entries()]
    .map(([kind, group]) => {
      const waits = group.map((sample) => sample.waitMs);
      return {
        kind,
        count: group.length,
        medianMs: wholeMs(quantile(waits, 0.5)),
        p90Ms: wholeMs(quantile(waits, 0.9)),
      };
    })
    .sort((a, b) => b.count - a.count);
  return {
    count: samples.length,
    medianMs: wholeMs(
      quantile(
        samples.map((sample) => sample.waitMs),
        0.5,
      ),
    ),
    byKind,
  };
}
