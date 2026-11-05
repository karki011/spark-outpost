import type { TextTable } from './compare.ts';
import { usd } from './format.ts';
import type { BenchRun, CellResult, PickRecord } from './results.ts';

const SCOPES: Record<string, string> = {
  one_spot: 'one spot',
  one_module: 'one module',
  few_modules: 'few modules',
  codebase: 'codebase',
};

function withConfidence(value: string | null, confidence: number | null): string {
  if (value === null) return '–';
  return confidence === null ? value : `${value} (${confidence.toFixed(2)})`;
}

function pickText(pick: PickRecord | null | undefined): string {
  if (!pick?.model) return '–';
  return `${pick.model} · ${pick.effort ?? '–'}`;
}

function groupsText(groups: readonly number[][]): string {
  return groups.length === 0
    ? 'none'
    : groups.map((group) => group.map((index) => index + 1).join('+')).join(', ');
}

function criticRan(result: CellResult): string {
  return result.agents.some((agent) => agent.role === 'critic') ? 'yes' : 'no';
}

function passText(result: CellResult): string {
  return result.verification.passed ? 'pass' : 'fail';
}

function harnessRuns(run: BenchRun): CellResult[] {
  return run.results
    .filter((result) => result.mode === 'harness' && result.routing)
    .sort((a, b) => a.task.localeCompare(b.task) || a.repeat - b.repeat);
}

function hasRound3Records(run: BenchRun): boolean {
  return harnessRuns(run).some((result) => result.routing?.intake !== undefined);
}

export function decisionsTable(run: BenchRun): TextTable | null {
  if (!hasRound3Records(run)) return null;
  const rows = harnessRuns(run).map((result) => {
    const routing = result.routing!;
    const intake = routing.intake;
    const architect = routing.architect;
    const parallel = routing.parallel;
    const scope = intake?.scope ? (SCOPES[intake.scope] ?? intake.scope) : null;
    const complexity = intake?.complexity === null || !intake ? null : intake.complexity.toFixed(1);
    return [
      `${result.task} #${result.repeat}`,
      withConfidence(scope, intake?.scopeConfidence ?? null),
      withConfidence(complexity, intake?.complexityConfidence ?? null),
      routing.depth,
      architect ? `${pickText(architect.pick)} (${architect.routedBy})` : 'none',
      parallel
        ? `${groupsText(parallel.chosen)} (rules: ${groupsText(parallel.rulesGroups)})`
        : '–',
      criticRan(result),
      passText(result),
      usd(result.costUsd),
    ];
  });
  return {
    head: [
      'Run',
      'Scope',
      'Complexity',
      'Depth',
      'Architect (picked by)',
      'Parallel groups',
      'Critic',
      'Pass',
      'Cost',
    ],
    rows,
  };
}

export function architectTable(run: BenchRun): TextTable | null {
  const rows = harnessRuns(run).flatMap((result) => {
    const architect = result.routing?.architect;
    if (!architect) return [];
    const same =
      architect.jevPick?.model === architect.rulePick?.model &&
      architect.jevPick?.effort === architect.rulePick?.effort;
    return [
      [
        `${result.task} #${result.repeat}`,
        pickText(architect.jevPick),
        `${pickText(architect.rulePick)} (${architect.rule ?? '–'})`,
        architect.jevPick ? (same ? 'same' : 'differs') : '–',
        withConfidence(architect.gate, architect.confidence),
        architect.routedBy,
        passText(result),
        usd(result.costUsd),
        usd(result.agents.find((agent) => agent.role === 'architect')?.costUsd ?? 0),
      ],
    ];
  });
  if (rows.length === 0) return null;
  return {
    head: [
      'Run',
      'Jev’s pick',
      'Rule’s pick (rule)',
      'Jev vs rule',
      'Gate (confidence)',
      'Ran',
      'Pass',
      'Run cost',
      'Architect cost',
    ],
    rows,
  };
}

export function parallelTable(run: BenchRun): TextTable | null {
  const rows = harnessRuns(run).flatMap((result) => {
    const parallel = result.routing?.parallel;
    if (!parallel) return [];
    const builders = result.agents.filter((agent) => agent.role === 'builder');
    const grouped = builders.filter((agent) => agent.parallelGroup !== null).length;
    return [
      [
        `${result.task} #${result.repeat}`,
        parallel.jevStatus,
        groupsText(parallel.rulesGroups),
        groupsText(parallel.chosen),
        `${parallel.agreed} of ${parallel.asked}`,
        `${builders.length} (${grouped} parallel)`,
        passText(result),
      ],
    ];
  });
  if (rows.length === 0) return null;
  return {
    head: [
      'Run',
      'Jev',
      'Heuristic groups',
      'Chosen groups',
      'Jev agreed with heuristic',
      'Builders',
      'Pass',
    ],
    rows,
  };
}

export interface Round3Section {
  title: string;
  intro: string;
  table: TextTable;
}

export function round3Sections(run: BenchRun): Round3Section[] {
  const sections: Round3Section[] = [];
  const decisions = decisionsTable(run);
  if (decisions) {
    sections.push({
      title: 'Jev decisions per harness run',
      intro:
        'Scope and complexity are Jev’s intake answers with their confidence. The Architect column is the model that planned and who picked it (jev, rules, or fixed when Jev did not answer). Parallel groups use plan step numbers.',
      table: decisions,
    });
  }
  const architect = architectTable(run);
  if (architect) {
    sections.push({
      title: 'Architect: Jev’s pick vs the rule',
      intro:
        'Every Architect route records Jev’s pick and the rule’s pick. Jev’s pick runs only when the gate acts (0.9, or 0.8 for the same tier or cheaper); destructive work always keeps the top tier.',
      table: architect,
    });
  }
  const parallel = parallelTable(run);
  if (parallel) {
    sections.push({
      title: 'Parallel: Jev vs the heuristic',
      intro:
        'After each plan in a git repo, Jev answers an independence noul per adjacent step pair and a size noul per step. Answers at 0.75 certainty or more override the heuristic; “agreed” counts confident answers that matched it.',
      table: parallel,
    });
  }
  return sections;
}
