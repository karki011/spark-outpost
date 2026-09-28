import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import type { Browser } from '@playwright/test';
import { keychainSecretStore } from '../../apps/server/src/setup/secrets.ts';
import { stopBench } from '../bench/live.ts';
import { stopParseWorker } from '../../apps/server/src/codescan/parse-pool.ts';
import { runArm, type ArmContext, type ArmResult } from './arms.ts';
import { STUB_URL } from './config.ts';
import { printPlan } from './plan-print.ts';
import { BLOCKS, planCells, VERSIONS, type Block, type Cell, type Version } from './plan.ts';
import { assertScratchDir, createScenarioRepo, verifyScenario } from './repo.ts';
import { renderReport } from './report.ts';
import { cellCost, projectedUsd, type CellRecord, type E2eRun } from './results.ts';
import {
  ROOT,
  answers,
  startProcess,
  startStack,
  stopProcess,
  stopStack,
  waitFor,
  type Runtime,
  type Stack,
} from './stack.ts';
import { openBrowser } from './ui-driver.ts';
import { DAY_ARMS, DEV_DAY_HARD_CAP_USD, printDayPlan, runDevDay } from './dev-day/run-day.ts';
import { DEFAULT_RATES } from './dev-day/score.ts';
import { selfTest } from './dev-day/selftest.ts';
import type { BaseArm } from './scenario-types.ts';
import { prepareVersion, removeVersion } from './versions.ts';

const { values } = parseArgs({
  options: {
    blocks: { type: 'string', default: 'core' },
    match: { type: 'string', default: '' },
    repeats: { type: 'string', default: '1' },
    budget: { type: 'string', default: '0' },
    live: { type: 'boolean', default: false },
    dir: { type: 'string' },
    label: { type: 'string', default: 'run' },
    'timeout-min': { type: 'string', default: '15' },
    'keep-data': { type: 'boolean', default: false },
    plan: { type: 'boolean', default: false },
    'remove-versions': { type: 'boolean', default: false },
    selftest: { type: 'boolean', default: false },
    shots: { type: 'boolean', default: false },
    arms: { type: 'string', default: DAY_ARMS.join(',') },
    'hourly-usd': { type: 'string', default: String(DEFAULT_RATES.hourlyUsd) },
  },
});

const runtime: Runtime = values.live ? 'acp' : 'fake';
const blocks = values.blocks.split(',').map((block) => {
  if (!BLOCKS.includes(block as Block)) throw new Error(`Unknown block ${block}.`);
  return block as Block;
});
const pattern = values.match ? new RegExp(values.match) : null;
const zaiReady =
  runtime === 'fake' ||
  (await keychainSecretStore()
    .get('zai')
    .catch(() => null)) !== null;
const cells = planCells().filter(
  (cell) =>
    blocks.includes(cell.block) &&
    (!pattern || pattern.test(cell.key)) &&
    (cell.block !== 'glm' || zaiReady),
);
if (blocks.includes('glm') && !zaiReady)
  console.log('Skipping the GLM block: no Z.ai key is stored.');

interface Runner {
  dir: string;
  run: E2eRun;
  resultsPath: string;
  stacks: Map<Version, Stack>;
  browser: Browser | null;
  arm: ArmContext | null;
  stub: ReturnType<typeof startProcess> | null;
}

function newestFirst(): string {
  return String(9_999_999_999_999 - Date.now()).padStart(13, '0');
}

function askedFirst(cell: Cell, result: ArmResult, repo: string): boolean {
  if (cell.scenario.task.verify !== 'clarify') return false;
  const clarified = result.turns.some((turn) =>
    turn.metrics.approvals.some((approval) => approval.kind === 'clarify'),
  );
  const status = execFileSync('git', ['-C', repo, 'status', '--porcelain'], { encoding: 'utf8' });
  const reply = result.turns[0]?.metrics.reply ?? '';
  return clarified || (status.trim() === '' && reply.includes('?'));
}

async function runCell(runner: Runner, cell: Cell, repeat: number): Promise<CellRecord> {
  const name = `${newestFirst()}-${cell.scenario.id}-${cell.arm}-${cell.variant}-${repeat}`;
  const path = join(runner.dir, 'repos', name.replace(/[^\w.-]+/g, '-'));
  const withDeps = cell.arm === 'harness' && cell.setup.withDeps;
  const created = await createScenarioRepo(cell.scenario.task, path, withDeps);
  const startedAt = new Date().toISOString();
  let error: string | null = null;
  let result: ArmResult = { turns: [], consoleErrors: [], notes: [], cleanup: null };
  try {
    result = await runArm(runner.arm!, cell, created.repo.path);
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }
  const asked = askedFirst(cell, result, created.repo.path);
  const verification = await verifyScenario(cell.scenario.task, created, {
    reply: result.turns.at(-1)?.metrics.reply ?? '',
    asked,
    cleanup: result.cleanup,
  });
  const harness = cell.arm === 'harness';
  return {
    key: cell.key,
    block: cell.block,
    variant: cell.variant,
    scenario: cell.scenario.id,
    arm: cell.arm,
    repeat,
    driver: harness ? cell.setup.driver : 'direct',
    setup: harness ? cell.setup : null,
    codexEffort: cell.arm === 'direct-codex' ? cell.codexEffort : null,
    startedAt,
    repo: created.repo.path,
    deps: created.deps,
    turns: result.turns,
    verification,
    passed: verification.passed && error === null,
    asked,
    cleanup: result.cleanup,
    costUsd: cellCost(result.turns),
    wallMs: result.turns.reduce((sum, turn) => sum + turn.metrics.wallMs, 0),
    activeMs: result.turns.reduce((sum, turn) => sum + turn.metrics.activeMs, 0),
    consoleErrors: result.consoleErrors,
    notes: [...result.notes, ...result.turns.flatMap((turn) => turn.outcome?.notes ?? [])],
    error,
    ...(result.labels ? { labels: result.labels } : {}),
  };
}

async function loadRun(path: string): Promise<E2eRun> {
  const existing = await readFile(path, 'utf8').catch(() => null);
  if (existing) return JSON.parse(existing) as E2eRun;
  return {
    version: 1,
    date: new Date().toISOString().slice(0, 10),
    runtime,
    budgetUsd: Number(values.budget),
    spentUsd: 0,
    stoppedForBudget: false,
    settings: {
      harness:
        'The real app: API and worker processes on their own database, Auto routing with Jev, Do at Balanced, driven through the web UI with Playwright (older versions through the HTTP API); approvals and checkpoints answered like a Balanced user.',
      directClaude:
        'scripts/bench direct arm: one Claude agent (Sonnet 5, medium) in Do mode at Full auto, no orchestrator, no Jev.',
      directCodex:
        'codex exec (gpt-6-sol) in a workspace-write sandbox, no harness; cost estimated from tokens at API prices.',
    },
    cells: [],
  };
}

async function save(runner: Runner): Promise<void> {
  await writeFile(runner.resultsPath, `${JSON.stringify(runner.run, null, 2)}\n`);
  await writeFile(runner.resultsPath.replace(/\.json$/, '.md'), renderReport(runner.run));
}

function needsUi(version: Version): boolean {
  return cells.some(
    (cell) =>
      cell.arm === 'harness' && cell.setup.version === version && cell.setup.driver === 'ui',
  );
}

function armContext(runner: Runner): ArmContext {
  return {
    runtime,
    dir: runner.dir,
    timeoutMs: Number(values['timeout-min']) * 60_000,
    benches: new Map(),
    browser: async () => (runner.browser ??= await openBrowser()),
    stack: async (cell) => {
      const version = cell.setup.version;
      const existing = runner.stacks.get(version);
      if (existing) return existing;
      const root = await prepareVersion(runner.dir, version);
      const stack = await startStack(runtime, version, root, runner.dir, needsUi(version));
      runner.stacks.set(version, stack);
      return stack;
    },
  };
}

function summary(record: CellRecord, spent: number): string {
  const why = record.passed
    ? ''
    : ` ${[record.error, ...record.verification.reasons].filter(Boolean).join(' ')}`;
  const verdict = record.passed ? 'PASS' : 'FAIL';
  return `  ${verdict} ${(record.wallMs / 1000).toFixed(1)} s $${record.costUsd.toFixed(4)} spent=$${spent.toFixed(3)}${why.slice(0, 400)}`;
}

const LIMIT = /rate.?limit|usage limit|too many requests|\b429\b|overloaded|quota/i;

function rateLimited(record: CellRecord): boolean {
  const errors = [record.error, ...record.turns.map((turn) => turn.metrics.error)];
  return errors.some((text) => text !== null && LIMIT.test(text));
}

async function runQueue(runner: Runner): Promise<void> {
  const { run } = runner;
  for (let repeat = 1; repeat <= Number(values.repeats); repeat++) {
    for (const cell of cells) {
      if (run.cells.some((record) => record.key === cell.key && record.repeat === repeat)) continue;
      const projected = projectedUsd(run, cell);
      if (runtime === 'acp' && run.spentUsd + projected > run.budgetUsd) {
        run.stoppedForBudget = true;
        console.log(
          `Stopping before ${cell.key} #${repeat}: spent $${run.spentUsd.toFixed(3)}, next could cost $${projected.toFixed(3)}.`,
        );
        return;
      }
      console.log(`Running ${cell.key} #${repeat}…`);
      const record = await runCell(runner, cell, repeat);
      run.cells.push(record);
      run.spentUsd += record.costUsd;
      console.log(summary(record, run.spentUsd));
      await save(runner);
      if (rateLimited(record)) {
        run.stoppedForBudget = false;
        console.log(`Paused after ${cell.key} #${repeat}: an agent hit a rate or usage limit.`);
        return;
      }
    }
  }
}

async function startStub(dir: string): Promise<Runner['stub']> {
  if (runtime !== 'fake') return null;
  const logs = join(dir, 'logs');
  await mkdir(logs, { recursive: true });
  const script = join(ROOT, 'scripts/e2e-live/stub.ts');
  const stub = startProcess('stub', ['--import', 'tsx', script], ROOT, process.env, logs);
  await waitFor(answers(`${STUB_URL}/health`), 'The Jev stub');
  return stub;
}

async function devDay(dir: string): Promise<void> {
  if (blocks.length > 1) throw new Error('Run the dev-day block on its own.');
  if (values.selftest) {
    const lines = await selfTest(dir);
    for (const line of lines)
      console.log(`${line.ok ? 'OK ' : 'BAD'} ${line.session} ${line.note}`);
    if (lines.some((line) => !line.ok)) process.exitCode = 1;
    return;
  }
  const budget = Number(values.budget) > 0 ? Number(values.budget) : DEV_DAY_HARD_CAP_USD;
  const arms = values.arms.split(',').map((arm) => {
    if (!DAY_ARMS.includes(arm as BaseArm)) throw new Error(`Unknown arm ${arm}.`);
    return arm as BaseArm;
  });
  if (runtime === 'fake') process.env.E2E_FAKE_CODEX = '1';
  const stub = await startStub(dir);
  try {
    await runDevDay({
      runtime,
      dir,
      label: values.label,
      budgetUsd: budget,
      timeoutMs: Number(values['timeout-min']) * 60_000,
      arms,
      match: pattern,
      shots: values.shots,
      keepData: values['keep-data'],
      rates: { ...DEFAULT_RATES, hourlyUsd: Number(values['hourly-usd']) },
    });
  } finally {
    if (stub) await stopProcess(stub.child);
  }
}

async function main(): Promise<void> {
  if (values.plan && blocks.includes('dev-day')) return printDayPlan(pattern);
  if (values.plan) return printPlan(cells, Number(values.repeats));
  if (!values.dir) throw new Error('Pass --dir with a scratch folder.');
  const dir = await assertScratchDir(values.dir);
  if (blocks.includes('dev-day')) return devDay(dir);
  if (values['remove-versions']) {
    for (const version of VERSIONS) await removeVersion(dir, version);
    return;
  }
  if (runtime === 'acp' && Number(values.budget) <= 0)
    throw new Error('A live run needs --budget.');
  if (runtime === 'fake') process.env.E2E_FAKE_CODEX = '1';
  await mkdir(join(dir, 'shots'), { recursive: true });
  const resultsPath = join(dir, `results-${values.label}.json`);
  const run = await loadRun(resultsPath);
  run.budgetUsd = Number(values.budget);
  run.stoppedForBudget = false;
  const runner: Runner = {
    dir,
    run,
    resultsPath,
    stacks: new Map(),
    browser: null,
    arm: null,
    stub: null,
  };
  runner.arm = armContext(runner);
  try {
    runner.stub = await startStub(dir);
    await runQueue(runner);
  } finally {
    await runner.browser?.close();
    for (const env of runner.arm.benches.values()) await stopBench(env);
    for (const stack of runner.stacks.values()) await stopStack(stack, values['keep-data']);
    if (runner.stub) await stopProcess(runner.stub.child);
    await save(runner);
    if (blocks.includes('routing')) await stopParseWorker();
  }
  console.log(`Spent $${run.spentUsd.toFixed(3)}. Results in ${resultsPath}.`);
}

await main();
