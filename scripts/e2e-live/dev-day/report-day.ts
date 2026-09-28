import type { DayRun } from './run-day.ts';
import type { DayRecord } from './session-run.ts';
import { rank, summarise, type ArmSummary, type ScoredRun } from './score.ts';
import { SESSIONS } from './sessions.ts';

const usd = (value: number | null) => (value === null ? '–' : `$${value.toFixed(3)}`);
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const percent = (value: number) => `${Math.round(value * 100)}%`;

function table(head: string[], rows: string[][]): string {
  const line = (cells: string[]) =>
    `| ${cells.map((cell) => cell.replaceAll('|', '\\|').replaceAll('\n', ' ')).join(' | ')} |`;
  return [line(head), line(head.map(() => '---')), ...rows.map(line)].join('\n');
}

function scored(records: readonly DayRecord[]): ScoredRun[] {
  return records.map((record) => ({
    arm: record.arm,
    score: record.score,
    costUsd: record.costUsd,
    wallMs: record.wallMs,
    interventions: record.evidence.interventions.length,
  }));
}

function summaryRows(summaries: readonly ArmSummary[]): string[][] {
  return summaries.map((summary, index) => [
    String(index + 1),
    summary.arm,
    `${summary.passes}/${summary.sessions} (${percent(summary.passRate)})`,
    usd(summary.spendUsd),
    usd(summary.costPerPassUsd),
    String(summary.interventions),
    `${summary.userMinutes} min`,
    usd(summary.trueCostUsd),
    usd(summary.trueCostPerPassUsd),
    seconds(summary.wallMs),
  ]);
}

function failedChecks(record: DayRecord): string {
  const failures = record.score.checks
    .filter((check) => check.ok === false)
    .map((check) => `${check.id}: ${check.detail}`);
  if (record.overCap) failures.push(`over the $${record.capUsd.toFixed(2)} session cap`);
  return failures.join('; ') || '–';
}

function sessionRows(records: readonly DayRecord[]): string[][] {
  return records.map((record) => {
    const hidden = record.score.checks.find((check) => check.id === 'hidden');
    const expected = SESSIONS.find((session) => session.id === record.session)?.expect.kind ?? '?';
    return [
      `${record.session} ${record.title}`,
      record.arm,
      `${expected} → ${record.score.kind}`,
      record.score.passed ? 'pass' : 'FAIL',
      hidden ? hidden.detail : '–',
      String(record.evidence.interventions.length),
      String(record.evidence.clicks),
      seconds(record.wallMs),
      usd(record.costUsd),
      record.score.repairMinutes > 0 ? `${record.score.repairMinutes} min` : '–',
      `+${record.diff.added} −${record.diff.removed}`,
      failedChecks(record),
    ];
  });
}

function behaviorRows(records: readonly DayRecord[]): string[][] {
  return records
    .filter((record) => record.arm === 'harness')
    .flatMap((record) =>
      record.score.behaviors.map((behavior) => [
        record.session,
        behavior.id,
        behavior.ok === null ? 'n/a' : behavior.ok ? 'yes' : 'NO',
        behavior.detail,
      ]),
    );
}

function detailLines(records: readonly DayRecord[]): string[] {
  return records.flatMap((record) => {
    const crews = record.turns.map((turn) => turn.crew.join(', ') || 'no agents').join(' → ');
    const interventions = record.evidence.interventions.map((item) => item.text).join('; ');
    const shots = record.shots.map((shot) => `[shot](${shot})`).join(' ');
    return [
      `- **${record.session} · ${record.arm}** (${record.level}): crew ${crews}.` +
        `${interventions ? ` Interventions: ${interventions}.` : ''}` +
        `${record.evidence.changed.length ? ` Changed: ${record.evidence.changed.slice(0, 8).join(', ')}.` : ''}` +
        `${shots ? ` ${shots}` : ''}`,
    ];
  });
}

export function verdict(summaries: readonly ArmSummary[]): string {
  const [best, next] = rank(summaries);
  if (!best) return 'No sessions ran.';
  if (!next) return `Only ${best.arm} ran.`;
  if (best.passRate > next.passRate) {
    return `${best.arm} leads on pass rate (${percent(best.passRate)} vs ${percent(next.passRate)} for ${next.arm}); it ranks first whatever it spent.`;
  }
  return `${best.arm} and ${next.arm} pass the same share (${percent(best.passRate)}); ${best.arm} ranks first on cost per pass counting the developer's time (${usd(best.trueCostPerPassUsd)} vs ${usd(next.trueCostPerPassUsd)}).`;
}

export function renderDayReport(run: DayRun): string {
  const runs = scored(run.records);
  const summaries = rank(run.arms.map((arm) => summarise(arm, runs, run.rates)));
  const behaviors = behaviorRows(run.records);
  return [
    `# Developer's day · ${run.date} (${run.runtime})`,
    '',
    `Spend: ${usd(run.spentUsd)} of the ${usd(run.budgetUsd)} budget.${run.stopped ? ` ${run.stopped}` : ''}`,
    '',
    `Ranking: pass rate first, then cost per pass counting the developer's time at $${run.rates.hourlyUsd}/h (${run.rates.interventionMinutes} min per intervention plus each failed session's repair estimate). Spend alone never decides it.`,
    '',
    `**${verdict(summaries)}**`,
    '',
    table(
      [
        'Rank',
        'Arm',
        'Passed',
        'Spend',
        'Spend per pass',
        'Interventions',
        'User time',
        'Spend + user time',
        'Per pass incl. user time',
        'Wall',
      ],
      summaryRows(summaries),
    ),
    '',
    '## Settings',
    '',
    ...Object.entries(run.settings).map(([key, value]) => `- **${key}:** ${value}`),
    ...Object.entries(run.levels).map(([key, value]) => `- **level ${key}:** ${value}`),
    ...Object.entries(run.setup).map(([key, value]) => `- **${key}:** ${value}`),
    '',
    '## Sessions',
    '',
    table(
      [
        'Session',
        'Arm',
        'Kind (expected → got)',
        'Pass',
        'Hidden tests',
        'Interventions',
        'Clicks',
        'Wall',
        'Cost',
        'Repair est.',
        'Diff',
        'Failed checks',
      ],
      sessionRows(run.records),
    ),
    '',
    '## Harness expectations',
    '',
    'Reported next to the outcome, not inside it: the direct arms have no crew, cards or Ship.',
    '',
    behaviors.length > 0
      ? table(['Session', 'Expectation', 'Met', 'Detail'], behaviors)
      : 'No harness sessions ran.',
    '',
    '## Details',
    '',
    ...detailLines(run.records),
    '',
  ].join('\n');
}
