import { STORY_ARMS, type StoryArmKey } from './arms.ts';
import type { StoryRecord, StoryRun } from './record.ts';
import { armStats, criteria } from './summary.ts';

const usd = (value: number | null) => (value === null ? '—' : `$${value.toFixed(2)}`);
const secs = (ms: number) => `${Math.round(ms / 1000)} s`;
const pct = (value: number | null) => (value === null ? '—' : `${Math.round(value * 100)}%`);
const counts = (value: { pass: number; tests: number } | null) =>
  value ? `${value.pass}/${value.tests}` : '—';
const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

function armTable(run: StoryRun): string[] {
  const keys = Object.keys(STORY_ARMS) as StoryArmKey[];
  const rows = keys
    .map((key) => armStats(run, key))
    .filter((stats) => stats.runs > 0)
    .map((stats) =>
      [
        stats.label,
        `${stats.passes}/${stats.runs}`,
        usd(stats.spendUsd),
        usd(stats.meanCostUsd),
        String(stats.interventions),
        usd(stats.trueCostPerPassUsd),
        secs(stats.meanWallMs),
        pct(stats.coordinatorShare),
        stats.violationsPerStory.toFixed(1),
        String(stats.integratorTurns),
        String(stats.mergeConflictRuns),
        String(stats.renumbered),
        String(stats.handoffs),
        String(stats.providerMoves),
        stats.maxPeakContext === null ? '—' : `${Math.round(stats.maxPeakContext / 1000)}K`,
        String(stats.criticBeyondChecks),
      ].join(' | '),
    );
  return [
    '| Arm | Passed | Spend | Mean cost | Interventions | Cost per pass incl. developer | Mean wall | Coordinator share | Violations / story | Integrator turns | Runs with conflicts | Renumbered | Handoffs | Provider moves | Peak Builder context | Critic beyond checks |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map((row) => `| ${row} |`),
  ];
}

function pieceSummary(record: StoryRecord): string {
  const metrics = record.metrics;
  if (!metrics) return '—';
  if (metrics.pieces.length === 0)
    return metrics.engaged === false ? `one Builder (${metrics.engageReason ?? ''})` : 'no pieces';
  const pieces = metrics.pieces
    .map((piece) => `${piece.key}:${piece.status}${piece.provider ? `@${piece.provider}` : ''}`)
    .join(' ');
  return `${metrics.placement} · ${pieces}`;
}

function runRows(run: StoryRun): string[] {
  return [
    '| Arm | Run | Level | Result | Hidden | Suite | Cost | Wall | Pieces | Failed checks |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...run.records.map(
      (record) =>
        `| ${record.arm} | ${record.rep}${record.ship ? ' (PR)' : ''} | ${record.level} | ${record.passed ? 'pass' : 'FAIL'} | ${counts(record.hidden)} | ${counts(record.suite)} | ${usd(record.costUsd)} | ${secs(record.wallMs)} | ${cell(pieceSummary(record))} | ${cell(record.failedChecks.join('; ')).slice(0, 240)} |`,
    ),
  ];
}

function prLines(run: StoryRun): string[] {
  const shipped = run.records.filter((record) => record.ship);
  if (shipped.length === 0) return [];
  return [
    '',
    '## Full auto → PR runs',
    '',
    '| Arm | Draft PR | Piece table in body |',
    '| --- | --- | --- |',
    ...shipped.map(
      (record) =>
        `| ${record.arm} | ${record.pr?.opened ? (record.pr.draft ? 'draft' : 'not draft') : 'none'} | ${record.pr?.pieceTable ? 'yes' : 'no'} |`,
    ),
  ];
}

export function renderStoryReport(run: StoryRun): string {
  return [
    `# Story benchmark · ${run.date} (${run.runtime})`,
    '',
    `Spent $${run.spentUsd.toFixed(2)} of $${run.budgetUsd}. ${run.stopped ?? ''}`.trim(),
    '',
    '## Arms (Automatic runs)',
    '',
    ...armTable(run),
    '',
    '## Runs',
    '',
    ...runRows(run),
    ...prLines(run),
    '',
    '## Turn-off criteria (plan §10)',
    '',
    ...criteria(run).map(
      (criterion) => `- **${criterion.verdict}** — ${criterion.rule}. ${criterion.evidence}.`,
    ),
    '',
  ].join('\n');
}
