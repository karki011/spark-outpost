import type { HealthScore, OverviewDay, OverviewTotals } from '@spark-outpost/contracts';
import {
  percent,
  plural,
  ratedTurns,
  ratePercent,
  shortDate,
  signedScore,
  usd,
} from './analytics-model.ts';

export function healthSummary(health: HealthScore): string {
  if (health.score === null) {
    return 'There are not enough turns with a clear outcome yet to score Spark.';
  }
  const scored = health.components.filter((part) => part.score !== null);
  const weakest = [...scored].sort((a, b) => a.score! - b.score!)[0];
  const grade =
    health.grade === 'healthy' ? 'healthy' : health.grade === 'fair' ? 'fair' : 'needs attention';
  return `Health is ${health.score} of 100 (${grade}). The weakest part is ${weakest!.label.toLowerCase()} at ${weakest!.score}.`;
}

export function activitySummary(days: readonly OverviewDay[]): string {
  const turns = days.reduce((sum, day) => sum + day.turns, 0);
  if (turns === 0) return `No turns in the last ${plural(days.length, 'day')}.`;
  const active = days.filter((day) => day.turns > 0).length;
  const busiest = days.reduce((best, day) => (day.turns > best.turns ? day : best));
  return `${plural(turns, 'turn')} on ${active} of ${plural(days.length, 'day')}. The busiest day was ${shortDate(busiest.date)} with ${plural(busiest.turns, 'turn')}.`;
}

function trendSentence(first: number, second: number): string {
  if (first === 0) return '';
  if (second > first * 1.1) return ' Spend rose in the second half of the range.';
  if (second < first * 0.9) return ' Spend fell in the second half of the range.';
  return ' Spend was steady across the range.';
}

export function spendSummary(days: readonly OverviewDay[], total: number): string {
  if (total === 0) return 'Nothing was spent in this range.';
  const peak = days.reduce((best, day) => (day.costUsd > best.costUsd ? day : best));
  const half = Math.floor(days.length / 2);
  const first = days.slice(0, half).reduce((sum, day) => sum + day.costUsd, 0);
  const second = days.slice(half).reduce((sum, day) => sum + day.costUsd, 0);
  const trend = trendSentence(first, second);
  return `${usd(total)} in total, ${usd(total / days.length)} a day on average. The highest day was ${shortDate(peak.date)} at ${usd(peak.costUsd)}.${trend}`;
}

export function outcomeSummary(totals: OverviewTotals): string {
  const rated = ratedTurns(totals);
  if (rated === 0) return 'No finished turns have an outcome yet.';
  const keep =
    totals.keepRate === null
      ? 'No changes were kept or reverted'
      : `${ratePercent(totals.keepRate)} of changes were kept`;
  const checks =
    totals.checkPassRate === null
      ? 'no checks ran'
      : `checks passed first time on ${ratePercent(totals.checkPassRate)} of turns`;
  return `${percent(totals.good, rated)} of ${plural(rated, 'turn')} went well (mean score ${signedScore(totals.meanScore)}). ${keep}, and ${checks}.`;
}
