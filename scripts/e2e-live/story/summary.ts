import type { Rates } from '../dev-day/score.ts';
import { STORY_ARMS, type StoryArmKey } from './arms.ts';
import { FAILED_STORY_MINUTES } from './story.ts';
import type { StoryRecord, StoryRun } from './record.ts';

export function storyPassed(failedChecks: readonly string[]): boolean {
  return failedChecks.every((check) => check.startsWith('finished:'));
}

export function developerMinutes(
  record: { passed: boolean; interventions: readonly unknown[] },
  rates: Rates,
): number {
  return (
    record.interventions.length * rates.interventionMinutes +
    (record.passed ? 0 : FAILED_STORY_MINUTES)
  );
}

export interface ArmStats {
  arm: StoryArmKey;
  label: string;
  runs: number;
  passes: number;
  passRate: number;
  spendUsd: number;
  meanCostUsd: number;
  interventions: number;
  userMinutes: number;
  trueCostPerPassUsd: number | null;
  meanWallMs: number;
  coordinatorShare: number | null;
  violationsPerStory: number;
  integratorTurns: number;
  mergeConflictRuns: number;
  renumbered: number;
  handoffs: number;
  providerMoves: number;
  rateLimitErrors: number;
  maxPeakContext: number | null;
  criticBeyondChecks: number;
  engagedRuns: number;
  placements: string[];
  hiddenFailing: string[];
}

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
const mean = (values: readonly number[]) => (values.length === 0 ? 0 : sum(values) / values.length);

export function automaticRuns(run: StoryRun, arm: StoryArmKey): StoryRecord[] {
  return run.records.filter((record) => record.arm === arm && !record.ship);
}

export function armStats(run: StoryRun, arm: StoryArmKey): ArmStats {
  const records = automaticRuns(run, arm);
  const passes = records.filter((record) => record.passed).length;
  const spendUsd = sum(records.map((record) => record.costUsd));
  const userMinutes = sum(records.map((record) => developerMinutes(record, run.rates)));
  const trueCost = spendUsd + (userMinutes / 60) * run.rates.hourlyUsd;
  const metrics = records.flatMap((record) => (record.metrics ? [record.metrics] : []));
  const coordinator = sum(metrics.map((metric) => metric.coordinatorCostUsd));
  const peaks = metrics.flatMap((metric) =>
    metric.builderPeaks.flatMap((peak) => (peak.peakContext === null ? [] : [peak.peakContext])),
  );
  return {
    arm,
    label: STORY_ARMS[arm].label,
    runs: records.length,
    passes,
    passRate: records.length === 0 ? 0 : passes / records.length,
    spendUsd,
    meanCostUsd: records.length === 0 ? 0 : spendUsd / records.length,
    interventions: sum(records.map((record) => record.interventions.length)),
    userMinutes,
    trueCostPerPassUsd: passes === 0 ? null : trueCost / passes,
    meanWallMs: mean(records.map((record) => record.wallMs)),
    coordinatorShare: metrics.length === 0 || spendUsd === 0 ? null : coordinator / spendUsd,
    violationsPerStory: mean(metrics.map((metric) => metric.ownershipViolations)),
    integratorTurns: sum(metrics.map((metric) => metric.integratorTurns)),
    mergeConflictRuns: metrics.filter(
      (metric) => metric.mergeConflicts > 0 || metric.mergeConflictCards > 0,
    ).length,
    renumbered: sum(metrics.map((metric) => metric.renumberedMigrations)),
    handoffs: sum(metrics.map((metric) => metric.providerHandoffs + metric.contextHandoffs)),
    providerMoves: sum(metrics.map((metric) => metric.providerMoves)),
    rateLimitErrors: sum(metrics.map((metric) => metric.rateLimitErrors)),
    maxPeakContext: peaks.length === 0 ? null : Math.max(...peaks),
    criticBeyondChecks: records.filter((record) => record.criticBeyondChecks === true).length,
    engagedRuns: metrics.filter((metric) => metric.pieces.length > 0).length,
    placements: [...new Set(metrics.flatMap((metric) => metric.placement ?? []))],
    hiddenFailing: [...new Set(records.flatMap((record) => record.hiddenFailing))],
  };
}

export type Verdict = 'keep' | 'turn off' | 'not enough data';

export interface Criterion {
  rule: string;
  verdict: Verdict;
  evidence: string;
}

const pct = (value: number) => `${Math.round(value * 100)}%`;
const usd = (value: number | null) => (value === null ? 'no pass' : `$${value.toFixed(2)}`);
const secs = (ms: number) => `${Math.round(ms / 1000)} s`;

function perPass(stats: ArmStats): number {
  return stats.trueCostPerPassUsd ?? Number.POSITIVE_INFINITY;
}

function parallelCriterion(parallel: ArmStats, a: ArmStats, a2: ArmStats | null): Criterion {
  const baseline = [a, a2].filter((arm): arm is ArmStats => arm !== null && arm.runs > 0);
  const rule = `Parallel ${parallel.label}: ≥30% faster than the better of a/a2, same or higher pass rate, cost per pass incl. developer time ≤ 1.2× arm a`;
  if (parallel.runs === 0 || baseline.length === 0 || a.runs === 0)
    return { rule, verdict: 'not enough data', evidence: 'arm not run' };
  const fastest = baseline.reduce((best, arm) => (arm.meanWallMs < best.meanWallMs ? arm : best));
  const bestPass = Math.max(...baseline.map((arm) => arm.passRate));
  const faster = 1 - parallel.meanWallMs / fastest.meanWallMs;
  const costRatio = perPass(parallel) / perPass(a);
  const ok = faster >= 0.3 && parallel.passRate >= bestPass && costRatio <= 1.2;
  return {
    rule,
    verdict: ok ? 'keep' : 'turn off',
    evidence: `wall ${secs(parallel.meanWallMs)} vs ${secs(fastest.meanWallMs)} (${fastest.arm}): ${pct(faster)} faster; pass ${pct(parallel.passRate)} vs best ${pct(bestPass)}; cost per pass ${usd(parallel.trueCostPerPassUsd)} vs a ${usd(a.trueCostPerPassUsd)} (${Number.isFinite(costRatio) ? `${costRatio.toFixed(2)}×` : 'n/a'})`,
  };
}

function inOrderCriterion(a: ArmStats, a2: ArmStats): Criterion {
  const rule =
    'Pieces in order (a2): passes at least as often as one Builder and fixes something one Builder gets wrong';
  if (a.runs === 0 || a2.runs === 0)
    return { rule, verdict: 'not enough data', evidence: 'arm not run' };
  const fixes = a.hiddenFailing.filter((name) => !a2.hiddenFailing.includes(name));
  const ok = a2.passRate >= a.passRate && (a.passRate < 1 ? fixes.length > 0 : false);
  const extra =
    a.passes === a.runs && perPass(a) <= perPass(a2)
      ? ' One Builder passed every run at lower cost per pass: the coordinator should engage only on request.'
      : '';
  return {
    rule,
    verdict: ok ? 'keep' : 'turn off',
    evidence: `pass ${pct(a2.passRate)} vs ${pct(a.passRate)}; hidden tests a failed that a2 never failed: ${fixes.length === 0 ? 'none' : fixes.join('; ')}; cost per pass ${usd(a2.trueCostPerPassUsd)} vs ${usd(a.trueCostPerPassUsd)}.${extra}`,
  };
}

function isolationCriteria(shared: ArmStats, worktree: ArmStats): Criterion[] {
  const onlyWorktrees = shared.runs > 0 && shared.violationsPerStory > 1;
  const conflictShare = worktree.runs === 0 ? 0 : worktree.mergeConflictRuns / worktree.runs;
  return [
    {
      rule: 'Keep only worktrees if ownership violations average more than 1 per shared-tree story (or a run needed a manual repair after a neighbour)',
      verdict: shared.runs === 0 ? 'not enough data' : onlyWorktrees ? 'turn off' : 'keep',
      evidence: `shared tree (b): ${shared.violationsPerStory.toFixed(2)} violations per story over ${shared.runs} runs`,
    },
    {
      rule: 'Keep only the shared tree if merge conflicts show in more than 20% of worktree runs (or dependency prep adds more than a minute per piece)',
      verdict: worktree.runs === 0 ? 'not enough data' : conflictShare > 0.2 ? 'turn off' : 'keep',
      evidence: `worktrees (c): conflicts in ${worktree.mergeConflictRuns}/${worktree.runs} runs (${pct(conflictShare)}), ${worktree.renumbered} renumbered migrations`,
    },
  ];
}

function providerCriterion(run: StoryRun, b: ArmStats, c: ArmStats): Criterion {
  const rule =
    'Multi-provider assignment: arm b must beat the same placement on one provider, and failures must not cluster on one provider';
  if (b.runs === 0) return { rule, verdict: 'not enough data', evidence: 'arm b not run' };
  const failedPieces = automaticRuns(run, 'b').flatMap((record) =>
    (record.metrics?.pieces ?? []).filter((piece) => piece.status !== 'landed'),
  );
  const byProvider = new Map<string, number>();
  for (const piece of failedPieces)
    byProvider.set(piece.provider ?? '?', (byProvider.get(piece.provider ?? '?') ?? 0) + 1);
  const clustered = [...byProvider.values()].some(
    (count) => failedPieces.length >= 2 && count === failedPieces.length,
  );
  const beats = c.runs > 0 && b.passRate >= c.passRate && perPass(b) <= perPass(c);
  return {
    rule,
    verdict: c.runs === 0 ? 'not enough data' : beats && !clustered ? 'keep' : 'turn off',
    evidence: `b (Claude + Codex, shared tree) pass ${pct(b.passRate)}, ${usd(b.trueCostPerPassUsd)} per pass; nearest one-provider arm is c (Claude only, worktrees — a different placement): pass ${pct(c.passRate)}, ${usd(c.trueCostPerPassUsd)} per pass. Unlanded pieces by provider: ${[...byProvider].map(([provider, count]) => `${provider} ${count}`).join(', ') || 'none'}`,
  };
}

function passRateCriterion(stats: ArmStats[], a: ArmStats): Criterion {
  const lower = stats.filter(
    (arm) => arm.arm !== 'a' && arm.arm !== 'direct' && arm.runs > 0 && arm.passRate < a.passRate,
  );
  return {
    rule: 'Anything that lowers the pass rate against arm a is reverted',
    verdict: a.runs === 0 ? 'not enough data' : lower.length > 0 ? 'turn off' : 'keep',
    evidence:
      lower.length > 0
        ? `below a (${pct(a.passRate)}): ${lower.map((arm) => `${arm.arm} ${pct(arm.passRate)}`).join(', ')}`
        : `no coordinated arm passed less often than a (${pct(a.passRate)})`,
  };
}

export function criteria(run: StoryRun): Criterion[] {
  const stats = (key: StoryArmKey) => armStats(run, key);
  const a = stats('a');
  const a2 = stats('a2');
  const b = stats('b');
  const c = stats('c');
  const all = (['a', 'a2', 'b', 'c', 'd'] as const).map(stats);
  return [
    parallelCriterion(b, a, a2.runs > 0 ? a2 : null),
    parallelCriterion(c, a, a2.runs > 0 ? a2 : null),
    inOrderCriterion(a, a2),
    ...isolationCriteria(b, c),
    providerCriterion(run, b, c),
    passRateCriterion(all, a),
  ];
}
