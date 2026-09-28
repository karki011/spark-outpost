import {
  agentRoleLabel,
  BUILD_STYLES,
  type AgentRole,
  type AgreementRow,
  type AnalyticsHarness,
  type CheckSummary,
  type ConfidencePoint,
  type CriticSummary,
  type DisagreementRow,
  type DisagreementWinner,
  type FlowPath,
  type LeanRow,
  type LoopSummary,
  type OutcomeTally,
  type RoutingCostRow,
} from '@spark-outpost/contracts';
import { turnCost, type TurnFact } from './facts.ts';
import { checkRollup, groupBy, mean, outcomeTally, quantile, roundTo } from './tally.ts';

const MIN_SIDE_TURNS = 3;
const WINNER_MARGIN = 0.2;
const CONFIDENCE_POINTS_MAX = 400;
const DISAGREEMENTS_MAX = 12;

const ROLE_ORDER: AgentRole[] = ['scout', 'architect', 'builder', 'critic'];

export function crewShape(roles: readonly AgentRole[], builders: number): string {
  if (roles.length === 0) return 'Solo';
  return ROLE_ORDER.filter((role) => roles.includes(role))
    .map((role) =>
      role === 'builder' && builders > 1 ? `Builder ×${builders}` : agentRoleLabel(role),
    )
    .join(' + ');
}

export function flowPaths(facts: readonly TurnFact[]): FlowPath[] {
  const paths = new Map<string, FlowPath>();
  for (const fact of facts) {
    const path = {
      category: fact.category,
      depth: fact.depth,
      crew: crewShape(fact.roles, fact.builders),
      model: fact.modelLabel,
      provider: fact.provider,
      outcome: fact.verdict ?? 'pending',
    };
    const key = Object.values(path).join('\u0000');
    const existing = paths.get(key);
    if (existing) existing.turns += 1;
    else paths.set(key, { ...path, turns: 1 });
  }
  return [...paths.values()].sort((a, b) => b.turns - a.turns);
}

export function confidencePoints(facts: readonly TurnFact[]): ConfidencePoint[] {
  return facts
    .filter((fact) => fact.jevConfidence !== null && fact.verdict !== null)
    .slice(-CONFIDENCE_POINTS_MAX)
    .map((fact) => ({
      confidence: roundTo(fact.jevConfidence!),
      score: fact.score,
      verdict: fact.verdict!,
      decision: fact.gateDecision,
      actAt: fact.actAt,
    }));
}

export function winner(jevRan: OutcomeTally, rulesRan: OutcomeTally): DisagreementWinner {
  const scored = (tally: OutcomeTally) => tally.turns >= MIN_SIDE_TURNS && tally.meanScore !== null;
  if (!scored(jevRan) || !scored(rulesRan)) return 'not_enough';
  const gap = jevRan.meanScore! - rulesRan.meanScore!;
  if (Math.abs(gap) < WINNER_MARGIN) return 'tie';
  return gap > 0 ? 'jev' : 'rules';
}

export function disagreements(facts: readonly TurnFact[]): DisagreementRow[] {
  const rows = facts.flatMap((fact) =>
    fact.jevAnswered ? fact.differences.map((difference) => ({ difference, fact })) : [],
  );
  const groups = groupBy(rows, ({ difference }) =>
    [difference.field, difference.rule, difference.jev].join('\u0000'),
  );
  return [...groups.values()]
    .map((group) => {
      const { field, rule, jev } = group[0]!.difference;
      const turns = group.map((row) => row.fact);
      const jevRan = outcomeTally(turns.filter((fact) => fact.wouldApply === 'jev'));
      const rulesRan = outcomeTally(turns.filter((fact) => fact.wouldApply === 'rules'));
      return {
        field,
        rulePick: rule,
        jevPick: jev,
        turns: turns.length,
        jevRan,
        rulesRan,
        asked: turns.filter((fact) => fact.wouldApply === 'ask').length,
        winner: winner(jevRan, rulesRan),
      };
    })
    .sort((a, b) => b.turns - a.turns)
    .slice(0, DISAGREEMENTS_MAX);
}

const AGREEMENT_KEYS = ['same', 'differs', 'no_jev'] as const;

function agreementKey(fact: TurnFact): AgreementRow['key'] {
  if (!fact.jevAnswered) return 'no_jev';
  return fact.differences.length === 0 ? 'same' : 'differs';
}

export function routingCost(facts: readonly TurnFact[]): RoutingCostRow[] {
  const groups = groupBy(facts, agreementKey);
  return AGREEMENT_KEYS.map((key) => {
    const turns = groups.get(key) ?? [];
    const costUsd = turns.reduce((sum, fact) => sum + turnCost(fact), 0);
    const verified = turns.filter((fact) => fact.verdict === 'good').length;
    return {
      key,
      turns: turns.length,
      verified,
      costUsd: roundTo(costUsd, 6),
      costPerVerifiedUsd: verified > 0 ? roundTo(costUsd / verified, 6) : null,
    };
  });
}

export function agreement(facts: readonly TurnFact[]): AgreementRow[] {
  const groups = groupBy(facts, agreementKey);
  return AGREEMENT_KEYS.map((key) => ({
    key,
    ...outcomeTally(groups.get(key) ?? []),
  }));
}

const builds = (fact: TurnFact) => fact.roles.includes('builder');

export function leanRows(facts: readonly TurnFact[]): LeanRow[] {
  const groups = groupBy(facts.filter(builds), (fact) => fact.buildStyle);
  return BUILD_STYLES.flatMap((style) => {
    const turns = groups.get(style) ?? [];
    if (turns.length === 0) return [];
    const meanCost = mean(turns.map(turnCost));
    const net = turns.flatMap((fact) => fact.reviews).reduce((sum, r) => sum + (r.net ?? 0), 0);
    return [
      {
        style,
        ...outcomeTally(turns),
        kept: turns.filter((fact) => fact.kept).length,
        meanCostUsd: meanCost === null ? null : roundTo(meanCost, 6),
        netLines: Math.min(0, Math.round(net)),
      },
    ];
  });
}

export function criticSummary(facts: readonly TurnFact[]): CriticSummary {
  const reviews = facts.flatMap((fact) => fact.reviews);
  const building = facts.filter(builds);
  return {
    reviews: reviews.length,
    concerns: reviews.filter((review) => review.verdict === 'concerns').length,
    looksGood: reviews.filter((review) => review.verdict === 'looks_good').length,
    unclear: reviews.filter((review) => review.verdict === 'unclear').length,
    findings: reviews.reduce((sum, review) => sum + review.findings, 0),
    reviewed: outcomeTally(building.filter((fact) => fact.reviews.length > 0)),
    unreviewed: outcomeTally(building.filter((fact) => fact.reviews.length === 0)),
  };
}

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

export function waitSummary(samples: readonly WaitSample[]): AnalyticsHarness['approvals'] {
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
