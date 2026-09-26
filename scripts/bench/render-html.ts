import { aggregate, type CellSummary } from './aggregate.ts';
import { hardTable, passTotals, tuningCells, tuningTable, type TextTable } from './compare.ts';
import { crewLine, ratio, seconds, tokenCells, usd } from './format.ts';
import type { BenchRun, CellResult } from './results.ts';
import { round3Sections } from './round3.ts';
import { barChart, escapeHtml } from './svg-chart.ts';
import { TASKS } from './tasks.ts';

const SERIES = ['Direct', 'Harness'] as const;
const ANALYSIS = /<section id="analysis">[\s\S]*?<\/section>/;

const STYLE = `
:root {
  color-scheme: light;
  --surface: #fcfcfb; --raised: #f3f2ef; --border: #e2e0da;
  --ink: #0b0b0b; --ink-2: #52514e; --ink-3: #7a7873;
  --s1: #2a78d6; --s2: #eb6834; --s3: #8a8883; --good: #1a7f37; --bad: #c62828;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --surface: #1a1a19; --raised: #242422; --border: #3a3936;
    --ink: #ffffff; --ink-2: #c3c2b7; --ink-3: #93918a;
    --s1: #3987e5; --s2: #d95926; --s3: #85837d; --good: #57c26b; --bad: #ef6b6b;
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --surface: #1a1a19; --raised: #242422; --border: #3a3936;
  --ink: #ffffff; --ink-2: #c3c2b7; --ink-3: #93918a;
  --s1: #3987e5; --s2: #d95926; --s3: #85837d; --good: #57c26b; --bad: #ef6b6b;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--surface); color: var(--ink);
  font: 15px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 960px; margin: 0 auto; padding: 32px 16px 64px; }
h1 { font-size: 1.7rem; margin: 0 0 4px; }
h2 { font-size: 1.2rem; margin: 40px 0 12px; }
h3 { font-size: 1rem; margin: 28px 0 8px; }
p, li { color: var(--ink-2); }
.meta { color: var(--ink-3); font-size: .9rem; }
header { display: flex; justify-content: space-between; gap: 16px; align-items: start; }
button.theme { background: var(--raised); color: var(--ink); border: 1px solid var(--border);
  border-radius: 8px; padding: 6px 10px; font: inherit; cursor: pointer; white-space: nowrap; }
button.theme:focus-visible { outline: 2px solid var(--s1); outline-offset: 2px; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin-top: 24px; }
.tile { background: var(--raised); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; }
.tile .label { color: var(--ink-3); font-size: .8rem; }
.tile .value { font-size: 1.4rem; font-weight: 600; font-variant-numeric: tabular-nums; }
.tile .sub { color: var(--ink-2); font-size: .85rem; }
.charts { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; }
.chart { margin: 0; background: var(--raised); border: 1px solid var(--border); border-radius: 10px; padding: 12px; }
.chart figcaption { font-weight: 600; }
.chart svg { width: 100%; height: auto; display: block; }
.legend { display: flex; gap: 14px; font-size: .85rem; color: var(--ink-2); margin: 4px 0 6px; }
.key { display: inline-flex; align-items: center; gap: 6px; }
.swatch { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
.swatch.s1, path.s1 { background: var(--s1); fill: var(--s1); }
.swatch.s2, path.s2 { background: var(--s2); fill: var(--s2); }
.swatch.s3, path.s3 { background: var(--s3); fill: var(--s3); }
.grid { stroke: var(--border); stroke-width: 1; }
.baseline { stroke: var(--ink-3); stroke-width: 1; }
.tick { fill: var(--ink-3); font-size: 11px; font-variant-numeric: tabular-nums; }
.hit { fill: transparent; }
.mark:hover path { opacity: .8; }
.scroll { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: .85rem; font-variant-numeric: tabular-nums; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border); vertical-align: top; }
th { color: var(--ink-3); font-weight: 500; white-space: nowrap; }
td.num { white-space: nowrap; }
.pass { color: var(--good); font-weight: 600; }
.fail { color: var(--bad); font-weight: 600; }
blockquote { margin: 8px 0; padding: 8px 12px; border-left: 3px solid var(--border); color: var(--ink-2); background: var(--raised); border-radius: 0 8px 8px 0; }
code { font-size: .9em; }
`;

const SCRIPT = `
const button = document.querySelector('button.theme');
const apply = (theme) => { document.documentElement.dataset.theme = theme; button.textContent = theme === 'dark' ? 'Light theme' : 'Dark theme'; };
const initial = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
apply(initial);
button.addEventListener('click', () => apply(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
`;

function tile(label: string, value: string, sub: string): string {
  return `<div class="tile"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div><div class="sub">${escapeHtml(sub)}</div></div>`;
}

function htmlTable(head: readonly string[], rows: readonly string[][]): string {
  const header = head.map((cell) => `<th>${escapeHtml(cell)}</th>`).join('');
  const body = rows.map((cells) => `<tr>${cells.join('')}</tr>`).join('');
  return `<div class="scroll"><table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table></div>`;
}

const td = (text: string, numeric = false) =>
  `<td${numeric ? ' class="num"' : ''}>${escapeHtml(text)}</td>`;

function passCell(passed: boolean, text: string): string {
  return `<td class="${passed ? 'pass' : 'fail'}">${escapeHtml(text)}</td>`;
}

function chartGroups(
  cells: readonly CellSummary[],
  value: (cell: CellSummary) => number,
  show: (v: number) => string,
) {
  const tasks = [...new Set(cells.map((cell) => cell.task))];
  return tasks.map((task) => ({
    label: task,
    values: cells
      .filter((cell) => cell.task === task)
      .map((cell) => ({
        series: cell.mode === 'direct' ? SERIES[0] : SERIES[1],
        value: value(cell),
        display: show(value(cell)),
      })),
  }));
}

function resultRow(result: CellResult): string[] {
  return [
    td(`${result.mode} #${result.repeat}`),
    passCell(
      result.verification.passed,
      result.verification.passed ? 'pass' : `fail: ${result.verification.reasons.join(' ')}`,
    ),
    td(seconds(result.wallMs), true),
    td(usd(result.costUsd), true),
    td(tokenCells(result), true),
    td(String(result.agents.length), true),
    td(String(result.toolCalls), true),
    td(`+${result.verification.diff.added} −${result.verification.diff.removed}`, true),
    td(crewLine(result)),
  ];
}

function routingList(results: readonly CellResult[]): string {
  const items = results
    .filter((result) => result.routing)
    .map((result) => {
      const routing = result.routing!;
      const decisions = routing.decisions
        .map((decision) => {
          const confidence =
            decision.confidence === null ? '' : `, confidence ${decision.confidence.toFixed(2)}`;
          return `<li>${escapeHtml(`${decision.kind}${decision.role ? ` ${decision.role}` : ''}: ${decision.summary} (${decision.applied}${confidence})`)}</li>`;
        })
        .join('');
      return `<li>Run #${result.repeat}: depth <strong>${escapeHtml(routing.depth)}</strong> (${escapeHtml(routing.depthSource)}), risk ${escapeHtml(routing.risk)}<ul>${decisions}</ul></li>`;
    });
  return items.length > 0 ? `<ul>${items.join('')}</ul>` : '<p>No harness run recorded.</p>';
}

function taskSection(run: BenchRun, taskId: string): string {
  const task = TASKS.find((candidate) => candidate.id === taskId);
  const results = run.results.filter((result) => result.task === taskId);
  return `<h3>${escapeHtml(`${taskId} · ${task?.title ?? ''} (${task?.kind ?? ''})`)}</h3>
<blockquote>${escapeHtml(task?.prompt ?? '')}</blockquote>
${htmlTable(['Mode', 'Verified', 'Wall', 'Cost', 'Tokens in / out / cache read / cache write', 'Agents', 'Tools', 'Diff', 'Crew'], results.map(resultRow))}
<p><strong>Jev routing</strong></p>
${routingList(results.filter((result) => result.mode === 'harness'))}`;
}

function headline(run: BenchRun): string {
  const summary = aggregate(run.results);
  const rows = summary.comparisons.map((comparison) => {
    const cell = (mode: string) =>
      summary.cells.find((item) => item.task === comparison.task && item.mode === mode);
    const direct = cell('direct');
    const harness = cell('harness');
    return [
      td(comparison.task),
      td(direct ? `${direct.passed}/${direct.runs}` : 'n/a', true),
      td(harness ? `${harness.passed}/${harness.runs}` : 'n/a', true),
      td(direct ? usd(direct.costUsd.mean) : 'n/a', true),
      td(harness ? usd(harness.costUsd.mean) : 'n/a', true),
      td(ratio(comparison.costRatio), true),
      td(direct ? seconds(direct.wallMs.mean) : 'n/a', true),
      td(harness ? seconds(harness.wallMs.mean) : 'n/a', true),
      td(ratio(comparison.wallRatio), true),
    ];
  });
  return htmlTable(
    [
      'Task',
      'Direct pass',
      'Harness pass',
      'Direct cost',
      'Harness cost',
      'Cost ×',
      'Direct wall',
      'Harness wall',
      'Time ×',
    ],
    rows,
  );
}

function textTableHtml(source: TextTable): string {
  return htmlTable(
    source.head,
    source.rows.map((cells) => cells.map((cell, index) => td(cell, index > 0))),
  );
}

const TUNING_SERIES = ['Direct', 'Harness tuned', 'Harness before'] as const;

function tuningChart(baseline: BenchRun, run: BenchRun, cost: boolean): string {
  const groups = tuningCells(baseline, run).map((cells) => ({
    label: cells.task,
    values: (
      [
        [TUNING_SERIES[0], cells.direct],
        [TUNING_SERIES[1], cells.after],
        [TUNING_SERIES[2], cells.before],
      ] as const
    ).flatMap(([series, cell]) => {
      if (!cell) return [];
      const value = cost ? cell.costUsd.mean : cell.wallMs.mean / 1000;
      return [{ series, value, display: cost ? usd(value) : `${value.toFixed(1)} s` }];
    }),
  }));
  return barChart({
    title: cost
      ? 'Mean cost: baseline vs this run (USD)'
      : 'Mean wall time: baseline vs this run (s)',
    unit: cost ? (value) => `$${value.toFixed(2)}` : (value) => `${Math.round(value)}s`,
    series: TUNING_SERIES,
    groups,
  });
}

function comparisonHtml(run: BenchRun, baseline: BenchRun | null): string {
  const parts: string[] = [];
  if (baseline) {
    parts.push(`<h2>Against the baseline run</h2>
<p>Old is <code>harness-vs-direct-${escapeHtml(baseline.date)}.json</code>, whose own direct runs are the base of the old ratios; the “tuned” harness series and direct are this run. Pass columns read old / new.</p>
<div class="charts">${tuningChart(baseline, run, true)}${tuningChart(baseline, run, false)}</div>
${textTableHtml(tuningTable(baseline, run))}`);
  }
  const hard = hardTable(run);
  if (hard) {
    parts.push(`<h2>Hard set</h2>
<p>Pass rate over the hard tasks: direct ${escapeHtml(passTotals(run, 'hard', 'direct'))}, harness ${escapeHtml(passTotals(run, 'hard', 'harness'))}. Hidden checks decide the pass; “Critic ran” counts harness runs whose depth included the review.</p>
${textTableHtml(hard)}`);
  }
  for (const section of round3Sections(run)) {
    parts.push(`<h2>${escapeHtml(section.title)}</h2>
<p>${escapeHtml(section.intro)}</p>
${textTableHtml(section.table)}`);
  }
  return parts.join('\n');
}

function tiles(run: BenchRun): string {
  const { totals } = aggregate(run.results);
  const direct = totals.find((total) => total.mode === 'direct');
  const harness = totals.find((total) => total.mode === 'harness');
  const pass = (total: typeof direct) =>
    total ? `${total.passed}/${total.runs} verified` : 'no runs';
  return `<div class="tiles">
${tile('Total spend', usd(run.spentUsd), `of ${usd(run.budgetUsd)} budget, ${run.results.length} runs`)}
${tile('Direct cost', direct ? usd(direct.costUsd) : 'n/a', pass(direct))}
${tile('Harness cost', harness ? usd(harness.costUsd) : 'n/a', `${pass(harness)}, Jev ${harness ? usd(harness.jevCostUsd) : '$0'}`)}
${tile('Wall time', `${direct ? seconds(direct.wallMs) : 'n/a'} vs ${harness ? seconds(harness.wallMs) : 'n/a'}`, 'direct vs harness, summed')}
</div>`;
}

export function renderHtml(
  run: BenchRun,
  existing: string | null,
  baseline: BenchRun | null = null,
): string {
  const summary = aggregate(run.results);
  const tasks = [...new Set(run.results.map((result) => result.task))].sort();
  const analysis =
    existing?.match(ANALYSIS)?.[0] ??
    '<section id="analysis"><h2>Analysis</h2><p>To be written after the runs.</p></section>';
  const cost = barChart({
    title: 'Mean cost per task (USD)',
    unit: (value) => `$${value.toFixed(2)}`,
    series: SERIES,
    groups: chartGroups(summary.cells, (cell) => cell.costUsd.mean, usd),
  });
  const time = barChart({
    title: 'Mean wall time per task (seconds)',
    unit: (value) => `${Math.round(value)}s`,
    series: SERIES,
    groups: chartGroups(
      summary.cells,
      (cell) => cell.wallMs.mean / 1000,
      (v) => `${v.toFixed(1)} s`,
    ),
  });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Harness vs Direct</title>
<meta name="description" content="Cost, speed and quality of Spark Outpost's orchestrated harness against a single direct agent on ${tasks.length} coding tasks.">
<style>${STYLE}</style>
</head>
<body>
<main>
<header>
<div>
<h1>Harness vs direct</h1>
<p class="meta">Spark Outpost benchmark · ${escapeHtml(run.date)} · ${run.results.length} live runs · ${escapeHtml(run.settings.level)}</p>
</div>
<button class="theme" type="button">Dark theme</button>
</header>
<p><strong>Direct:</strong> ${escapeHtml(run.settings.direct)}<br><strong>Harness:</strong> ${escapeHtml(run.settings.harness)}<br><strong>Fixture:</strong> ${escapeHtml(run.settings.fixture)}</p>
${tiles(run)}
<h2>Cost and time per task</h2>
<div class="charts">${cost}${time}</div>
<h2>Headline</h2>
<p>Means per cell. Ratios are harness ÷ direct; below 1× means the harness was cheaper or faster.</p>
${headline(run)}
${comparisonHtml(run, baseline)}
${analysis}
<h2>Per task</h2>
${tasks.map((task) => taskSection(run, task)).join('\n')}
</main>
<script>${SCRIPT}</script>
</body>
</html>
`;
}
