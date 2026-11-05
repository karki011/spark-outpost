import type { AnalyticsSpend } from '@spark-outpost/contracts';
import { providerName } from '../chat/provider-name.ts';
import { percent, plural, usd, verdictName } from './analytics-model.ts';

export function treemapSummary(data: AnalyticsSpend): string {
  if (data.leaves.length === 0) return 'No run in this range reported or estimated a cost.';
  const total = data.leaves.reduce((sum, leaf) => sum + leaf.costUsd, 0);
  const top = data.leaves[0]!;
  const projects = new Set(data.leaves.map((leaf) => leaf.project)).size;
  const unpriced = data.unpricedRuns > 0 ? ` ${plural(data.unpricedRuns, 'run')} had no cost.` : '';
  return `${usd(total)} across ${plural(projects, 'project')}. The largest share is ${top.modelLabel} on ${providerName(top.provider)} in ${top.project}: ${usd(top.costUsd)}, ${percent(top.costUsd, total)} of agent spend. Jev added ${usd(data.jev.costUsd)}.${unpriced}`;
}

export function taskCostSummary(data: AnalyticsSpend): string {
  if (data.finishedTasks === 0) return 'No finished turns with an outcome yet.';
  const measured = data.perTask.filter((row) => row.tasks > 0 && row.meanUsd !== null);
  const perGood =
    data.costPerGoodUsd === null
      ? 'No turn had a good outcome yet.'
      : `Counting every finished turn, each good outcome cost ${usd(data.costPerGoodUsd)}.`;
  const [first, ...others] = measured;
  if (!first) {
    return `${plural(data.finishedTasks, 'finished turn')}, none with a known cost yet. ${perGood}`;
  }
  const dearest = others.reduce((best, row) => (row.meanUsd! > best.meanUsd! ? row : best), first);
  return `${plural(data.finishedTasks, 'finished turn')}. ${verdictName(dearest.verdict)} turns cost the most on average, ${usd(dearest.meanUsd)}. ${perGood}`;
}

export function sourceSummary(data: AnalyticsSpend): string {
  if (data.totalUsd === 0) return 'Nothing was spent in this range.';
  return `${usd(data.reportedUsd)} was reported by providers and ${usd(data.estimatedUsd)} (${percent(data.estimatedUsd, data.totalUsd)}) is estimated from tokens and list prices, including Jev.`;
}

export function savingsSummary(data: AnalyticsSpend): string {
  if (data.resume.sessionRuns === 0) return 'No run could resume a session.';
  return `${data.resume.resumedRuns} of ${plural(data.resume.sessionRuns, 'session run')} resumed, reusing cached input worth about ${usd(data.resume.savedUsd)}.`;
}
