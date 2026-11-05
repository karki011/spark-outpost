import type {
  AnalyticsOverview,
  AnalyticsSpend,
  AnalyticsWindow,
  ApprovalWaits,
  OutcomeVerdict,
  OverviewDay,
  RollupGroupBy,
  RollupReport,
  TaskCost,
} from '@spark-outpost/contracts';
import { mergeCostSource, outcomeVerdictSchema } from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';
import { turnFacts } from '../persistence/analytics-facts.ts';
import {
  dailySpend,
  jevSpend,
  sessionRuns,
  spendLeaves,
  type DailySpend,
} from '../persistence/analytics-spend.ts';
import { approvalWaits } from '../persistence/analytics-waits.ts';
import { turnCost, type TurnFact } from './facts.ts';
import { checkSummary, loopSummary, waitSummary } from './summaries.ts';
import { healthScore } from './health.ts';
import { resumeSavings } from './resume.ts';
import { rollups } from './rollups.ts';
import { groupBy, mean, outcomeTally, quantile, roundTo } from './tally.ts';
import { windowDates } from './window.ts';

export async function rollupReport(
  db: Queryable,
  workspaceId: string,
  window: AnalyticsWindow,
  by: RollupGroupBy,
): Promise<RollupReport> {
  const facts = await turnFacts(db, workspaceId, window);
  return { window, groupBy: by, rows: rollups(facts, by) };
}

function overviewDays(
  window: AnalyticsWindow,
  facts: readonly TurnFact[],
  spend: readonly DailySpend[],
): OverviewDay[] {
  const byDay = groupBy(facts, (fact) => fact.day);
  const spendByDay = new Map(spend.map((day) => [day.date, day]));
  return windowDates(window).map((date) => {
    const turns = byDay.get(date) ?? [];
    const tally = outcomeTally(turns);
    const cost = spendByDay.get(date);
    return {
      date,
      turns: turns.length,
      runs: cost?.runs ?? 0,
      costUsd: roundTo((cost?.reportedUsd ?? 0) + (cost?.estimatedUsd ?? 0), 6),
      good: tally.good,
      bad: tally.bad,
      mixed: tally.mixed,
      unclear: tally.unclear,
      kept: turns.filter((fact) => fact.kept).length,
      reverted: turns.filter((fact) => fact.reverted).length,
    };
  });
}

function spendTotals(days: readonly DailySpend[]) {
  return {
    reported: days.reduce((sum, day) => sum + day.reportedUsd, 0),
    estimated: days.reduce((sum, day) => sum + day.estimatedUsd, 0),
  };
}

export async function overviewReport(
  db: Queryable,
  workspaceId: string,
  window: AnalyticsWindow,
): Promise<AnalyticsOverview> {
  const [facts, spend, waits] = await Promise.all([
    turnFacts(db, workspaceId, window),
    dailySpend(db, workspaceId, window),
    approvalWaits(db, workspaceId, window),
  ]);
  const days = overviewDays(window, facts, spend);
  const tally = outcomeTally(facts);
  const checks = checkSummary(facts);
  const kept = facts.filter((fact) => fact.kept).length;
  const reverted = facts.filter((fact) => fact.reverted).length;
  const { reported, estimated } = spendTotals(spend);
  const settled = facts.filter((fact) => fact.verdict !== null);
  const wait = waitSummary(waits);
  return {
    window,
    days,
    totals: {
      turns: facts.length,
      runs: spend.reduce((sum, day) => sum + day.runs, 0),
      costUsd: roundTo(reported + estimated, 6),
      costSource: mergeCostSource(
        reported > 0 ? 'reported' : null,
        estimated > 0 ? 'estimated' : null,
      ),
      good: tally.good,
      bad: tally.bad,
      mixed: tally.mixed,
      unclear: tally.unclear,
      meanScore: tally.meanScore,
      kept,
      reverted,
      keepRate: kept + reverted > 0 ? roundTo(kept / (kept + reverted)) : null,
      checkRounds: checks.rounds,
      checkTurns: checks.turns,
      checksPassedFirst: checks.firstPassed,
      checkPassRate: checks.turns > 0 ? roundTo(checks.firstPassed / checks.turns) : null,
    },
    health: healthScore({
      verdicts: { good: tally.good, bad: tally.bad, mixed: tally.mixed, unclear: tally.unclear },
      settled: settled.length,
      troubled: settled.filter((fact) => fact.reverted || fact.corrected).length,
      checks,
      loops: loopSummary(facts),
      waits: wait.count,
      medianWaitMs: wait.medianMs,
    }),
  };
}

function taskCosts(facts: readonly TurnFact[]): TaskCost[] {
  const finished = groupBy(
    facts.filter((fact) => fact.verdict !== null),
    (fact) => fact.verdict!,
  );
  return outcomeVerdictSchema.options.map((verdict: OutcomeVerdict) => {
    const costs = (finished.get(verdict) ?? []).map(turnCost);
    const average = mean(costs);
    const median = quantile(costs, 0.5);
    return {
      verdict,
      tasks: costs.length,
      costUsd: roundTo(
        costs.reduce((sum, cost) => sum + cost, 0),
        6,
      ),
      meanUsd: average === null ? null : roundTo(average, 6),
      medianUsd: median === null ? null : roundTo(median, 6),
    };
  });
}

export async function spendReport(
  db: Queryable,
  workspaceId: string,
  window: AnalyticsWindow,
): Promise<AnalyticsSpend> {
  const [facts, leaves, days, jev, sessions] = await Promise.all([
    turnFacts(db, workspaceId, window),
    spendLeaves(db, workspaceId, window),
    dailySpend(db, workspaceId, window),
    jevSpend(db, workspaceId, window),
    sessionRuns(db, workspaceId, window),
  ]);
  const perTask = taskCosts(facts);
  const { reported, estimated } = spendTotals(days);
  const finished = perTask.reduce((sum, row) => sum + row.tasks, 0);
  const good = perTask.find((row) => row.verdict === 'good');
  const finishedCost = perTask.reduce((sum, row) => sum + row.costUsd, 0);
  return {
    window,
    totalUsd: roundTo(reported + estimated, 6),
    reportedUsd: roundTo(reported, 6),
    estimatedUsd: roundTo(estimated, 6),
    unpricedRuns: leaves.unpricedRuns,
    jev,
    leaves: leaves.leaves,
    days: days.map(({ date, reportedUsd, estimatedUsd }) => ({ date, reportedUsd, estimatedUsd })),
    perTask,
    finishedTasks: finished,
    costPerGoodUsd: good && good.tasks > 0 ? roundTo(finishedCost / good.tasks, 6) : null,
    resume: resumeSavings(sessions),
  };
}

export async function approvalWaitReport(
  db: Queryable,
  workspaceId: string,
  window: AnalyticsWindow,
): Promise<ApprovalWaits> {
  return waitSummary(await approvalWaits(db, workspaceId, window));
}
