import { GATE_LINES, type AnalyticsHarness, type OutcomeTally } from '@spark-outpost/contracts';
import {
  categoryName,
  depthName,
  percent,
  plural,
  signedScore,
  verdictName,
} from './analytics-model.ts';

function busiest<T>(paths: readonly T[], key: (path: T) => string, weight: (path: T) => number) {
  const totals = new Map<string, number>();
  for (const path of paths) totals.set(key(path), (totals.get(key(path)) ?? 0) + weight(path));
  return [...totals.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
}

export function flowSummary(data: AnalyticsHarness): string {
  if (data.flow.length === 0) return 'No turns in this range yet.';
  const weight = (path: AnalyticsHarness['flow'][number]) => path.turns;
  const category = busiest(data.flow, (path) => path.category, weight)!;
  const depth = busiest(data.flow, (path) => path.depth, weight)!;
  const crew = busiest(data.flow, (path) => path.crew, weight)!;
  const model = busiest(data.flow, (path) => path.model, weight)!;
  const good = data.flow
    .filter((path) => path.outcome === 'good')
    .reduce((sum, path) => sum + path.turns, 0);
  return `${plural(data.turns, 'turn')}. Most were ${categoryName(category[0]).toLowerCase()} requests (${category[1]}), most ran at ${depthName(depth[0]).toLowerCase()} depth (${depth[1]}) with ${crew[0] === 'Solo' ? 'no crew' : `a crew of ${crew[0]}`} (${crew[1]}), and ${model[0]} did the most work (${model[1]}). ${percent(good, data.turns)} ended with a good outcome.`;
}

function meanOf(points: AnalyticsHarness['confidence'], test: (value: number) => boolean) {
  const scores = points
    .filter((point) => test(point.confidence) && point.score !== null)
    .map((point) => point.score!);
  return scores.length === 0
    ? null
    : { n: scores.length, mean: scores.reduce((a, b) => a + b, 0) / scores.length };
}

export function confidenceSummary(data: AnalyticsHarness): string {
  if (data.confidence.length === 0)
    return 'Jev has not answered on any turn with an outcome in this range.';
  const act = GATE_LINES.find((line) => line.at === 0.9)!.at;
  const above = meanOf(data.confidence, (value) => value >= act);
  const below = meanOf(data.confidence, (value) => value < act);
  const part = (label: string, side: ReturnType<typeof meanOf>) =>
    side
      ? `${label} ${plural(side.n, 'turn')} averaged ${signedScore(side.mean)}`
      : `${label} no turns`;
  return `${plural(data.confidence.length, 'turn')} with Jev’s confidence and an outcome. ${part('At or above the 0.90 act line,', above)}; ${part('below it,', below)}.`;
}

export function disagreementSummary(data: AnalyticsHarness): string {
  const differs = data.agreement.find((row) => row.key === 'differs');
  const same = data.agreement.find((row) => row.key === 'same');
  if (!differs || differs.turns === 0) return 'Jev and the rules did not disagree in this range.';
  const decided = data.disagreements.filter(
    (row) => row.winner === 'jev' || row.winner === 'rules',
  );
  const jevWins = decided.filter((row) => row.winner === 'jev').length;
  const verdict =
    decided.length === 0
      ? 'None of the disagreements has 3 or more turns on each side yet, so no winner is called.'
      : `Where there is enough data, Jev’s pick did better in ${jevWins} of ${decided.length} patterns.`;
  return `They disagreed on ${plural(differs.turns, 'turn')} (mean ${signedScore(differs.meanScore)}) and agreed on ${plural(same?.turns ?? 0, 'turn')} (mean ${signedScore(same?.meanScore ?? null)}). ${verdict}`;
}

export function tallyTip(label: string, tally: OutcomeTally): string {
  if (tally.turns === 0) return `${label}: no turns`;
  return `${label}: ${plural(tally.turns, 'turn')}, ${percent(tally.good, tally.turns)} ${verdictName('good').toLowerCase()}, mean score ${signedScore(tally.meanScore)}`;
}

export function leanSummary(data: AnalyticsHarness): string {
  if (data.lean.length === 0) return 'No building turns in this range.';
  const best = data.lean
    .filter((row) => row.meanScore !== null)
    .sort((a, b) => b.meanScore! - a.meanScore!)[0];
  const parts = data.lean.map(
    (row) => `${row.style} ${plural(row.turns, 'turn')} (mean ${signedScore(row.meanScore)})`,
  );
  const net = data.lean.reduce((sum, row) => sum + row.netLines, 0);
  const critic =
    data.critic.reviews === 0
      ? 'The Critic did not review anything.'
      : `The Critic reviewed ${plural(data.critic.reviews, 'change')}, raised concerns on ${data.critic.concerns} and listed ${plural(data.critic.findings, 'finding')}${net < 0 ? `; it saw ${Math.abs(net)} lines that could go` : ''}.`;
  return `Build styles: ${parts.join(', ')}.${best ? ` ${best.style} scored best.` : ''} ${critic}`;
}

export function frictionSummary(data: AnalyticsHarness): string {
  const { checks, loops, approvals } = data;
  const checkLine =
    checks.turns === 0
      ? 'No checks ran.'
      : `Checks passed first time on ${checks.firstPassed} of ${plural(checks.turns, 'turn')} and in the end on ${checks.finalPassed}.`;
  const loopLine =
    loops.turns === 0
      ? ''
      : ` ${loops.withRetries} of ${plural(loops.turns, 'crew turn')} needed a retry or a fix round.`;
  const waitLine =
    approvals.count === 0
      ? ' No approvals waited on you.'
      : ` You answered ${plural(approvals.count, 'approval')}.`;
  return `${checkLine}${loopLine}${waitLine}`;
}
