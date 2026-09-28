import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { atK } from '../../apps/server/src/routing/labels.ts';
import type { RoutingLabel } from '../../apps/server/src/routing/labels.ts';
import type { CellRecord, E2eRun } from '../e2e-live/results.ts';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string' },
    'repair-minutes': { type: 'string', default: '10' },
    'hourly-usd': { type: 'string', default: '60' },
    threshold: { type: 'string', default: '0.8' },
  },
});

const MODELS = ['Haiku 4.5', 'Sonnet 5', 'Opus 5.5'] as const;
type Model = (typeof MODELS)[number];
const SHORT: Record<Model, string> = {
  'Haiku 4.5': 'Haiku',
  'Sonnet 5': 'Sonnet',
  'Opus 5.5': 'Opus',
};

interface Pick {
  pick: Model | null;
  confidence: number | null;
  basis: string | null;
}

interface Cell {
  file: string;
  scenario: string;
  variant: string;
  repeat: number;
  model: Model | null;
  passed: boolean;
  reasons: string[];
  costUsd: number;
  agentUsd: number;
  jevUsd: number;
  wallMs: number;
  escalated: boolean;
  verify: string[];
  critic: string[] | null;
  builders: string[];
  rule: string | null;
  ruleName: string | null;
  text: Pick;
  evidence: Pick;
  turn2: { rule: string | null; text: Pick; evidence: Pick } | null;
  changed: string[];
  predicted: string[];
  scanFiles: string[];
  rankLatencyMs: number | null;
  textLatencyMs: number | null;
  evidenceLatencyMs: number | null;
  status: string;
  error: string | null;
}

function asModel(name: string | null | undefined): Model | null {
  return MODELS.find((model) => model === name) ?? null;
}

function pickOf(variant: RoutingLabel['jevText']): Pick {
  return {
    pick: asModel(variant?.pick),
    confidence: variant?.confidence ?? null,
    basis: variant?.basis ?? null,
  };
}

function toCell(file: string, record: CellRecord): Cell {
  const labels = (record.labels ?? []) as RoutingLabel[];
  const first = labels[0];
  const second = labels[1];
  const metrics = record.turns.map((turn) => turn.metrics);
  const builders = metrics.flatMap((m) =>
    m.agents.filter((agent) => agent.role === 'builder').map((agent) => agent.model ?? '?'),
  );
  const rank = first?.rankJev as { latencyMs?: number } | null | undefined;
  return {
    file,
    scenario: record.scenario,
    variant: record.variant,
    repeat: record.repeat,
    model: asModel(first?.builder),
    passed: record.passed,
    reasons: record.verification.reasons,
    costUsd: record.costUsd,
    agentUsd: metrics.reduce((sum, m) => sum + m.agentCostUsd, 0),
    jevUsd: metrics.reduce((sum, m) => sum + m.jevCostUsd, 0),
    wallMs: record.wallMs,
    escalated: labels.some((label) => label.escalated),
    verify: labels.flatMap((label) => label.verify ?? []),
    critic: labels.some((label) => label.critic)
      ? labels.flatMap((label) => label.critic ?? [])
      : null,
    builders,
    rule: first?.rule.pick ?? null,
    ruleName: first?.rule.rule ?? null,
    text: pickOf(first?.jevText ?? null),
    evidence: pickOf(first?.jevEvidence ?? null),
    turn2: second
      ? {
          rule: second.rule.pick,
          text: pickOf(second.jevText),
          evidence: pickOf(second.jevEvidence),
        }
      : null,
    changed: record.verification.diff.files,
    predicted: first?.predictedFiles ?? [],
    scanFiles: first?.scanFiles ?? [],
    rankLatencyMs: rank?.latencyMs ?? null,
    textLatencyMs: first?.jevText?.latencyMs ?? null,
    evidenceLatencyMs: first?.jevEvidence?.latencyMs ?? null,
    status: metrics.map((m) => m.status).join('/'),
    error: record.error,
  };
}

const mean = (xs: readonly number[]) =>
  xs.length === 0 ? null : xs.reduce((sum, x) => sum + x, 0) / xs.length;
const median = (xs: readonly number[]) => {
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

async function load(): Promise<Cell[]> {
  const cells: Cell[] = [];
  for (const file of positionals) {
    const run = JSON.parse(await readFile(file, 'utf8')) as E2eRun;
    for (const record of run.cells) {
      if (record.block !== 'routing' || record.arm !== 'harness') continue;
      cells.push(toCell(file, record));
    }
  }
  return cells;
}

interface Arm {
  n: number;
  pass: number;
  meanCost: number;
  meanWallS: number;
}

function arm(cells: readonly Cell[]): Arm | null {
  if (cells.length === 0) return null;
  return {
    n: cells.length,
    pass: cells.filter((cell) => cell.passed).length / cells.length,
    meanCost: mean(cells.map((cell) => cell.costUsd))!,
    meanWallS: mean(cells.map((cell) => cell.wallMs / 1000))!,
  };
}

type PolicyId = 'rule' | 'jev-text' | 'jev-evidence' | 'jev-evidence-0.8';

function firstPick(shadow: readonly Cell[], which: 'text' | 'evidence'): Pick {
  return shadow[0]?.[which] ?? { pick: null, confidence: null, basis: null };
}

function score(cells: Cell[]) {
  const threshold = Number(values.threshold);
  const repairMinutes = Number(values['repair-minutes']);
  const hourly = Number(values['hourly-usd']);
  const byScenario = new Map<string, Cell[]>();
  for (const cell of cells)
    byScenario.set(cell.scenario, [...(byScenario.get(cell.scenario) ?? []), cell]);
  const scenarios = [...byScenario.keys()].sort();
  const opusCells = cells.filter((c) => c.model === 'Opus 5.5');
  const sonnetCells = cells.filter((c) => c.model === 'Sonnet 5');
  const opusRatio =
    (mean(opusCells.map((c) => c.costUsd)) ?? 0) / (mean(sonnetCells.map((c) => c.costUsd)) || 1);
  const perScenario = scenarios.map((id) => {
    const all = byScenario.get(id)!;
    const shadow = all.filter((cell) => cell.variant === 'rule');
    const rulePick = asModel(shadow[0]?.rule) ?? 'Sonnet 5';
    const text = firstPick(shadow, 'text');
    const evidence = firstPick(shadow, 'evidence');
    const gated: Model =
      evidence.pick && (evidence.confidence ?? 0) >= threshold ? evidence.pick : rulePick;
    const atModel = Object.fromEntries(
      MODELS.map((model) => [model, arm(all.filter((cell) => cell.model === model))]),
    ) as Record<Model, Arm | null>;
    const opusHere = mean(all.filter((c) => c.model === 'Opus 5.5').map((c) => c.costUsd));
    const sonnetHere = mean(all.filter((c) => c.model === 'Sonnet 5').map((c) => c.costUsd));
    const topRerun = opusHere ?? (sonnetHere ?? 0) * (opusRatio || 2.5);
    const repairUsd = topRerun + (repairMinutes / 60) * hourly;
    const policies: Record<PolicyId, Model | null> = {
      rule: rulePick,
      'jev-text': text.pick ?? rulePick,
      'jev-evidence': evidence.pick ?? rulePick,
      'jev-evidence-0.8': gated,
    };
    return {
      scenario: id,
      rulePick,
      ruleName: shadow[0]?.ruleName ?? null,
      text,
      evidence,
      shadowRuns: shadow.map((cell) => ({
        text: cell.text,
        evidence: cell.evidence,
        turn2: cell.turn2,
      })),
      atModel,
      repairUsd,
      policies,
    };
  });

  const policyIds: PolicyId[] = ['rule', 'jev-text', 'jev-evidence', 'jev-evidence-0.8'];
  const common = new Set(
    perScenario
      .filter((row) =>
        policyIds.every((policy) => {
          const model = row.policies[policy];
          return model !== null && row.atModel[model] !== null;
        }),
      )
      .map((row) => row.scenario),
  );
  const scoring = policyIds.map((policy) => {
    let covered = 0;
    let passes = 0;
    let cost = 0;
    let repair = 0;
    let differs = 0;
    const missing: string[] = [];
    for (const row of perScenario) {
      if (!common.has(row.scenario)) {
        const model = row.policies[policy];
        if (!model || !row.atModel[model])
          missing.push(`${row.scenario}:${model ? SHORT[model] : '?'}`);
        continue;
      }
      const model = row.policies[policy]!;
      if (model !== row.rulePick) differs++;
      const observed = row.atModel[model]!;
      covered++;
      passes += observed.pass;
      cost += observed.meanCost;
      repair += (1 - observed.pass) * row.repairUsd;
    }
    return {
      policy,
      covered,
      differsFromRule: differs,
      expectedPasses: passes,
      passRate: covered ? passes / covered : null,
      totalCost: cost,
      costPerPass: passes ? cost / passes : null,
      withRepair: cost + repair,
      perTaskWithRepair: covered ? (cost + repair) / covered : null,
      missing,
    };
  });

  const fixed = MODELS.map((model) => {
    const rows = perScenario.filter((row) => row.atModel[model] !== null);
    const runs = cells.filter((cell) => cell.model === model);
    const ruleRows = rows.filter((row) => row.atModel[row.rulePick] !== null);
    const side = (pick: (row: (typeof perScenario)[number]) => Arm) => {
      let passes = 0;
      let cost = 0;
      let repair = 0;
      for (const row of ruleRows) {
        const observed = pick(row);
        passes += observed.pass;
        cost += observed.meanCost;
        repair += (1 - observed.pass) * row.repairUsd;
      }
      return {
        scenarios: ruleRows.length,
        expectedPasses: passes,
        passRate: ruleRows.length ? passes / ruleRows.length : null,
        totalCost: cost,
        costPerPass: passes ? cost / passes : null,
        perTaskWithRepair: ruleRows.length ? (cost + repair) / ruleRows.length : null,
      };
    };
    return {
      policy: `fixed-${SHORT[model].toLowerCase()}`,
      scenarios: rows.map((row) => row.scenario),
      runs: runs.length,
      runPasses: runs.filter((cell) => cell.passed).length,
      tier: side((row) => row.atModel[model]!),
      ruleSameScenarios: side((row) => row.atModel[row.rulePick]!),
    };
  });

  const shadowCells = cells.filter((cell) => cell.variant === 'rule');
  const files = shadowCells
    .filter((cell) => cell.changed.length > 0)
    .map((cell) => ({
      scenario: cell.scenario,
      repeat: cell.repeat,
      changed: cell.changed.length,
      scan: atK(cell.scanFiles, cell.changed),
      predicted: atK(cell.predicted, cell.changed),
      top1: cell.predicted[0] ? cell.changed.includes(cell.predicted[0]) : false,
    }));
  const fileSummary = {
    tasks: files.length,
    scanP: mean(files.map((f) => f.scan.precision ?? 0)),
    scanR: mean(files.map((f) => f.scan.recall ?? 0)),
    jevP: mean(files.map((f) => f.predicted.precision ?? 0)),
    jevR: mean(files.map((f) => f.predicted.recall ?? 0)),
    jevTop1: files.filter((f) => f.top1).length,
  };
  const latency = {
    rankMedianMs: median(cells.flatMap((c) => (c.rankLatencyMs === null ? [] : [c.rankLatencyMs]))),
    textMedianMs: median(cells.flatMap((c) => (c.textLatencyMs === null ? [] : [c.textLatencyMs]))),
    evidenceMedianMs: median(
      cells.flatMap((c) => (c.evidenceLatencyMs === null ? [] : [c.evidenceLatencyMs])),
    ),
    rankMaxMs: Math.max(...cells.map((c) => c.rankLatencyMs ?? 0)),
    textMaxMs: Math.max(...cells.map((c) => c.textLatencyMs ?? 0)),
    evidenceMaxMs: Math.max(...cells.map((c) => c.evidenceLatencyMs ?? 0)),
    jevUsdPerTask: mean(cells.map((c) => c.jevUsd)),
    jevUsdTotal: cells.reduce((sum, c) => sum + c.jevUsd, 0),
  };
  const spend = {
    cells: cells.length,
    total: cells.reduce((sum, c) => sum + c.costUsd, 0),
    agents: cells.reduce((sum, c) => sum + c.agentUsd, 0),
    jev: latency.jevUsdTotal,
  };
  const output = {
    assumptions: {
      policyPick: 'first shadow run (variant rule) answer per scenario, turn 1',
      threshold,
      repair: `failure repair = top-tier rerun cost for that scenario + ${repairMinutes} min x $${hourly}/h`,
    },
    spend,
    commonScenarios: [...common],
    scoring,
    fixed,
    perScenario,
    files,
    fileSummary,
    latency,
    cells,
  };
  return output;
}

async function main() {
  const cells = await load();
  const output = score(cells);
  if (values.out) await writeFile(values.out, `${JSON.stringify(output, null, 2)}\n`);
  printTables(output);
}

function fmt(x: number | null | undefined, digits = 3): string {
  return x === null || x === undefined ? '—' : x.toFixed(digits);
}

function pickText(pick: Pick): string {
  if (!pick.pick) return '—';
  const how = pick.basis === 'choice' ? '' : pick.basis ? ` ${pick.basis}` : '';
  return `${SHORT[pick.pick]} ${fmt(pick.confidence, 2)}${how}`;
}

function armText(a: Arm | null): string {
  if (!a) return '—';
  const passed = Math.round(a.pass * a.n);
  return `${passed}/${a.n} · $${fmt(a.meanCost)} · ${Math.round(a.meanWallS)} s`;
}

function printTables(output: ReturnType<typeof score>) {
  console.log('| Scenario | Rule | Jev text | Jev evidence | Haiku | Sonnet | Opus |');
  console.log('| --- | --- | --- | --- | --- | --- | --- |');
  for (const row of output.perScenario) {
    console.log(
      `| ${row.scenario} | ${SHORT[row.rulePick as Model]} | ${pickText(row.text)} | ${pickText(row.evidence)} | ${MODELS.map((m) => armText(row.atModel[m])).join(' | ')} |`,
    );
  }
  console.log(
    '\n| Policy | Differs from rule | Covered | Pass | Cost | Cost/pass | Cost incl. repair | Per task incl. repair | Missing |',
  );
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const p of output.scoring) {
    console.log(
      `| ${p.policy} | ${p.differsFromRule} | ${p.covered} | ${fmt(p.expectedPasses, 2)} (${fmt((p.passRate ?? 0) * 100, 0)}%) | $${fmt(p.totalCost)} | $${fmt(p.costPerPass)} | $${fmt(p.withRepair, 2)} | $${fmt(p.perTaskWithRepair, 2)} | ${p.missing.join(', ')} |`,
    );
  }
  console.log(
    '\n| Fixed tier | Runs passed | Scenarios | Tier pass | Tier cost/pass | Tier per task incl. repair | Rule pass (same) | Rule cost/pass | Rule per task incl. repair |',
  );
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const f of output.fixed) {
    console.log(
      `| ${f.policy} | ${f.runPasses}/${f.runs} | ${f.scenarios.join(' ')} | ${fmt((f.tier.passRate ?? 0) * 100, 0)}% | $${fmt(f.tier.costPerPass)} | $${fmt(f.tier.perTaskWithRepair, 2)} | ${fmt((f.ruleSameScenarios.passRate ?? 0) * 100, 0)}% | $${fmt(f.ruleSameScenarios.costPerPass)} | $${fmt(f.ruleSameScenarios.perTaskWithRepair, 2)} |`,
    );
  }
  console.log(
    `\nScored over ${output.commonScenarios.length} scenarios: ${output.commonScenarios.join(' ')}`,
  );
  console.log('\nFiles', JSON.stringify(output.fileSummary));
  console.log('Latency', JSON.stringify(output.latency));
  console.log('Spend', JSON.stringify(output.spend));
}

await main();
