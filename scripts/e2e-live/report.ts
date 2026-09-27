import type { CellRecord, E2eRun } from './results.ts';

const usd = (value: number) => `$${value.toFixed(3)}`;
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

function table(head: string[], rows: string[][]): string {
  const line = (cells: string[]) =>
    `| ${cells.map((cell) => cell.replaceAll('|', '\\|').replaceAll('\n', ' ')).join(' | ')} |`;
  return [line(head), line(head.map(() => '---')), ...rows.map(line)].join('\n');
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function crew(cell: CellRecord): string {
  return cell.turns
    .flatMap((turn) => turn.metrics.agents)
    .map((agent) => `${agent.name ?? agent.role} ${agent.model ?? '?'}·${agent.effort ?? '?'}`)
    .join(', ');
}

function depth(cell: CellRecord): string {
  const routing = cell.turns.flatMap((turn) =>
    turn.metrics.routing ? [turn.metrics.routing] : [],
  );
  return (
    routing.map((item) => `${item.depth} (${item.depthSource}, ${item.risk})`).join(' → ') || '–'
  );
}

function answered(cell: CellRecord): string {
  if (cell.arm !== 'harness') return '–';
  const items = cell.turns.flatMap((turn) => turn.outcome?.answered ?? []);
  const auto = cell.turns
    .flatMap((turn) => turn.metrics.approvals)
    .filter((approval) => approval.decidedBy === 'auto').length;
  const via = (kind: string) => items.filter((item) => item.via === kind).length;
  return `${via('ui')} ui, ${via('api')} api, ${auto} auto`;
}

function extras(cell: CellRecord): string {
  const metrics = cell.turns.map((turn) => turn.metrics);
  const parts: string[] = [];
  const checks = metrics.flatMap((item) => item.checks);
  if (checks.length > 0) parts.push(`checks: ${checks.join('; ')}`);
  const fixes = metrics.reduce((sum, item) => sum + item.fixTurns, 0);
  if (fixes > 0) parts.push(`fix turns ${fixes}`);
  const sessions = metrics.flatMap((item) => item.sessionNotes);
  if (sessions.length > 0) parts.push(`sessions: ${sessions.join(', ')}`);
  const reviews = metrics.flatMap((item) => item.reviews);
  if (reviews.length > 0) {
    const text = reviews.map(
      (review) => `${review.reviewer} ${review.verdict} (${review.findings.length})`,
    );
    parts.push(`reviews: ${text.join(', ')}`);
  }
  const lanes = metrics
    .map((item) => item.lanes)
    .find((lane) => lane.parallelBuilders > 0 || lane.worktrees > 0);
  if (lanes) {
    parts.push(
      `lanes: ${lanes.parallelBuilders} parallel, ${lanes.worktrees} worktrees, deps ${lanes.depsMethods.join('/')} ${lanes.depsMs.join('/')} ms, waited ${lanes.depsWaitedMs.join('/')} ms`,
    );
  }
  const shortcuts = metrics.reduce((sum, item) => sum + item.shortcuts, 0);
  if (shortcuts > 0) parts.push(`lean shortcuts ${shortcuts}`);
  if (cell.asked) parts.push('asked first');
  if (cell.cleanup)
    parts.push(`cleanup: ${cell.cleanup.length === 0 ? 'clean' : cell.cleanup.join(' ')}`);
  if (cell.error) parts.push(`error: ${cell.error.slice(0, 200)}`);
  return parts.join(' · ') || '–';
}

function cellRows(cells: readonly CellRecord[]): string[][] {
  return cells.map((cell) => [
    `${cell.scenario} ${cell.variant} #${cell.repeat}`,
    cell.arm,
    cell.passed ? 'pass' : 'fail',
    usd(cell.costUsd),
    seconds(cell.wallMs),
    seconds(cell.activeMs),
    `+${cell.verification.diff.added} −${cell.verification.diff.removed}`,
    depth(cell),
    crew(cell),
    answered(cell),
    extras(cell),
  ]);
}

function groupRows(cells: readonly CellRecord[]): string[][] {
  const keys = [...new Set(cells.map((cell) => `${cell.scenario}|${cell.arm}|${cell.variant}`))];
  return keys.map((key) => {
    const [scenario, arm, variant] = key.split('|') as [string, string, string];
    const group = cells.filter(
      (cell) => cell.scenario === scenario && cell.arm === arm && cell.variant === variant,
    );
    const passed = group.filter((cell) => cell.passed).length;
    return [
      scenario,
      arm,
      variant,
      `${passed}/${group.length}`,
      usd(mean(group.map((cell) => cell.costUsd))),
      seconds(mean(group.map((cell) => cell.wallMs))),
      seconds(mean(group.map((cell) => cell.activeMs))),
    ];
  });
}

function notes(run: E2eRun): string {
  const lines = run.cells.flatMap((cell) =>
    cell.notes
      .filter((note) => note.kind !== 'info')
      .map(
        (note) =>
          `- ${cell.key} #${cell.repeat} (${note.kind}): ${note.text}${note.shot ? ` [shot](${note.shot})` : ''}`,
      ),
  );
  const console = run.cells.flatMap((cell) =>
    [...new Set(cell.consoleErrors)]
      .slice(0, 3)
      .map((text) => `- ${cell.key} #${cell.repeat} console: ${text}`),
  );
  return [...lines, ...console].join('\n') || 'None recorded.';
}

export function renderReport(run: E2eRun): string {
  const settings = Object.entries(run.settings).map(([key, value]) => `- **${key}:** ${value}`);
  const blocks = [...new Set(run.cells.map((cell) => cell.block))];
  const sections = blocks.flatMap((block) => {
    const cells = run.cells.filter((cell) => cell.block === block);
    return [
      `## ${block}`,
      '',
      table(
        ['Scenario', 'Arm', 'Variant', 'Pass', 'Mean cost', 'Mean wall', 'Mean active'],
        groupRows(cells),
      ),
      '',
      table(
        [
          'Cell',
          'Arm',
          'Pass',
          'Cost',
          'Wall',
          'Active',
          'Diff',
          'Depth',
          'Crew',
          'Answered',
          'Notes',
        ],
        cellRows(cells),
      ),
      '',
    ];
  });
  return [
    `# Live end-to-end run · ${run.date} (${run.runtime})`,
    '',
    `Spend: ${usd(run.spentUsd)} of the ${usd(run.budgetUsd)} budget${run.stoppedForBudget ? ', stopped for the budget' : ''}.`,
    '',
    ...settings,
    '',
    ...sections,
    '## UI notes',
    '',
    notes(run),
    '',
  ].join('\n');
}
