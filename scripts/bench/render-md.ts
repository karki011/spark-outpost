import { aggregate, tokensOf } from './aggregate.ts';
import { hardTable, passTotals, tuningTable, type TextTable } from './compare.ts';
import { crewLine, ratio, seconds, thousands, tokenCells, usd, verdict } from './format.ts';
import type { BenchRun, CellResult } from './results.ts';
import { round3Sections } from './round3.ts';
import { TASKS } from './tasks.ts';

export const ANALYSIS_HEADING = '## Analysis';

function row(cells: readonly (string | number)[]): string {
  return `| ${cells.map((cell) => String(cell).replaceAll('|', '\\|')).join(' | ')} |`;
}

function table(head: readonly string[], rows: readonly (readonly (string | number)[])[]): string {
  return [row(head), row(head.map(() => '---')), ...rows.map(row)].join('\n');
}

function resultRow(result: CellResult): (string | number)[] {
  return [
    `${result.mode} #${result.repeat}`,
    verdict(result),
    seconds(result.wallMs),
    seconds(result.activeMs),
    usd(result.costUsd),
    usd(result.jevCostUsd),
    tokenCells(result),
    result.agents.length,
    result.toolCalls,
    result.retries,
    `+${result.verification.diff.added} −${result.verification.diff.removed}`,
    crewLine(result),
  ];
}

const RESULT_HEAD = [
  'Mode',
  'Verified',
  'Wall',
  'Active',
  'Cost',
  'Jev',
  'Tokens in / out / cache read / cache write',
  'Agents',
  'Tools',
  'Retries',
  'Diff',
  'Crew',
];

function routingLines(results: readonly CellResult[]): string[] {
  const lines: string[] = [];
  for (const result of results) {
    if (!result.routing) continue;
    const { depth, depthSource, risk, decisions } = result.routing;
    lines.push(`- Run #${result.repeat}: depth **${depth}** (${depthSource}), risk ${risk}.`);
    for (const decision of decisions) {
      const confidence =
        decision.confidence === null ? '' : `, confidence ${decision.confidence.toFixed(2)}`;
      const role = decision.role ? ` ${decision.role}` : '';
      lines.push(
        `  - ${decision.kind}${role}: ${decision.summary} (applied ${decision.applied}${confidence}, Jev ${decision.jevStatus})`,
      );
    }
    const asked = result.asked.map((item) => `${item.kind} → ${item.answer}`);
    if (asked.length > 0) lines.push(`  - Asked: ${asked.join('; ')}`);
  }
  return lines;
}

function taskSection(run: BenchRun, taskId: string): string {
  const task = TASKS.find((candidate) => candidate.id === taskId);
  const results = run.results.filter((result) => result.task === taskId);
  const routing = routingLines(results.filter((result) => result.mode === 'harness'));
  const denied = results.flatMap((result) => result.asked.filter((item) => item.autoDenied));
  return [
    `### ${taskId} · ${task?.title ?? ''} (${task?.kind ?? ''})`,
    '',
    `> ${task?.prompt ?? ''}`,
    '',
    table(RESULT_HEAD, results.map(resultRow)),
    '',
    '**Jev routing (harness)**',
    '',
    ...(routing.length > 0 ? routing : ['- No harness run recorded.']),
    '',
    denied.length > 0
      ? `Auto-denied approvals: ${denied.map((item) => `${item.kind} "${item.title}"`).join('; ')}.`
      : 'No approval requests were auto-denied.',
  ].join('\n');
}

function totalsSection(run: BenchRun): string {
  const summary = aggregate(run.results);
  const totals = table(
    ['Mode', 'Runs', 'Verified', 'Wall', 'Active', 'Cost', 'Jev', 'Tokens', 'Agents'],
    summary.totals.map((total) => [
      total.mode,
      total.runs,
      `${total.passed}/${total.runs}`,
      seconds(total.wallMs),
      seconds(total.activeMs),
      usd(total.costUsd),
      usd(total.jevCostUsd),
      thousands(total.tokens),
      total.agents,
    ]),
  );
  const perTask = table(
    [
      'Task',
      'Direct pass',
      'Harness pass',
      'Direct cost',
      'Harness cost',
      'Cost ratio',
      'Direct wall',
      'Harness wall',
      'Time ratio',
    ],
    summary.comparisons.map((comparison) => {
      const cell = (mode: string) =>
        summary.cells.find((item) => item.task === comparison.task && item.mode === mode);
      const direct = cell('direct');
      const harness = cell('harness');
      return [
        comparison.task,
        direct ? `${direct.passed}/${direct.runs}` : 'n/a',
        harness ? `${harness.passed}/${harness.runs}` : 'n/a',
        direct ? usd(direct.costUsd.mean) : 'n/a',
        harness ? usd(harness.costUsd.mean) : 'n/a',
        ratio(comparison.costRatio),
        direct ? seconds(direct.wallMs.mean) : 'n/a',
        harness ? seconds(harness.wallMs.mean) : 'n/a',
        ratio(comparison.wallRatio),
      ];
    }),
  );
  return [
    '## Headline',
    '',
    'Means per cell; ratios are harness ÷ direct (below 1 means the harness was cheaper or faster).',
    '',
    perTask,
    '',
    '## Totals',
    '',
    totals,
  ].join('\n');
}

function textTable(source: TextTable): string {
  return table(source.head, source.rows);
}

function comparisonSections(run: BenchRun, baseline: BenchRun | null): string[] {
  const sections: string[] = [];
  if (baseline) {
    sections.push(
      [
        '## Against the baseline run',
        '',
        `Old is \`harness-vs-direct-${baseline.date}.json\` (its own direct runs are the base of the old ratios); the “tuned” harness columns and direct are this run. Pass columns read old / new.`,
        '',
        textTable(tuningTable(baseline, run)),
      ].join('\n'),
    );
  }
  const hard = hardTable(run);
  if (hard) {
    sections.push(
      [
        '## Hard set',
        '',
        `Pass rate over the hard tasks: direct ${passTotals(run, 'hard', 'direct')}, harness ${passTotals(run, 'hard', 'harness')}. Hidden checks decide the pass; "Critic ran" counts harness runs whose depth included the review.`,
        '',
        textTable(hard),
      ].join('\n'),
    );
  }
  for (const section of round3Sections(run)) {
    sections.push(
      [`## ${section.title}`, '', section.intro, '', textTable(section.table)].join('\n'),
    );
  }
  return sections;
}

export function renderMarkdown(
  run: BenchRun,
  preservedAnalysis: string | null,
  baseline: BenchRun | null = null,
): string {
  const tasks = [...new Set(run.results.map((result) => result.task))].sort();
  const header = [
    `# Harness vs direct benchmark · ${run.date}`,
    '',
    `Generated by \`pnpm bench:harness\` from \`harness-vs-direct-${run.date}.json\`. Spend: ${usd(run.spentUsd)} of the ${usd(run.budgetUsd)} budget${run.stoppedForBudget ? ' (stopped early to stay within budget)' : ''}.`,
    '',
    `- **Direct:** ${run.settings.direct}`,
    `- **Harness:** ${run.settings.harness}`,
    `- **Level:** ${run.settings.level}. **Fixture:** ${run.settings.fixture}`,
    `- Token columns are uncached input / output / cache read / cache write, summed over agents. Claude reports cache reads and writes separately from input; Codex counts cached reads inside input. Total tokens processed: ${thousands(run.results.reduce((sum, result) => sum + tokensOf(result), 0))}.`,
  ].join('\n');
  const sections = [
    header,
    totalsSection(run),
    ...comparisonSections(run, baseline),
    '## Per task',
    ...tasks.map((task) => taskSection(run, task)),
  ];
  const analysis = preservedAnalysis ?? `${ANALYSIS_HEADING}\n\nTo be written after the runs.\n`;
  return `${sections.join('\n\n')}\n\n${analysis.trimEnd()}\n`;
}

export function preservedAnalysis(existing: string | null): string | null {
  if (!existing) return null;
  const index = existing.indexOf(`\n${ANALYSIS_HEADING}\n`);
  return index < 0 ? null : existing.slice(index + 1);
}
