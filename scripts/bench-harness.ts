import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { buildStyleSchema } from '../packages/contracts/src/index.ts';
import type { LaneOptions } from '../apps/server/src/orchestration/placement.ts';
import { projectedCostUsd } from './bench/aggregate.ts';
import { createTaskRepo } from './bench/fixture.ts';
import { BENCH_LEVEL, PINNED, runLiveCell, startBench, stopBench } from './bench/live.ts';
import { renderHtml } from './bench/render-html.ts';
import { preservedAnalysis, renderMarkdown } from './bench/render-md.ts';
import { BENCH_MODES, type BenchMode, type BenchRun, type CellResult } from './bench/results.ts';
import { TASKS, taskById, type BenchTask } from './bench/tasks.ts';
import { ingestFiles } from './bench/ingest-files.ts';
import { createDb } from '../apps/server/src/persistence/db.ts';
import { precheck, verifyRepo } from './bench/verify.ts';

const FALLBACK_COST_USD: Record<BenchMode, number> = { direct: 0.5, harness: 1 };
const PER_RUN_CAP_USD = 1.5;
const CELL_TIMEOUT_MS = 10 * 60 * 1000;

const { values } = parseArgs({
  options: {
    tasks: { type: 'string', default: TASKS.map((task) => task.id).join(',') },
    modes: { type: 'string', default: BENCH_MODES.join(',') },
    repeats: { type: 'string', default: '1' },
    budget: { type: 'string', default: '6' },
    dir: { type: 'string', default: process.env.SPARK_BENCH_DIR ?? join(tmpdir(), 'spark-bench') },
    out: { type: 'string', default: 'docs/benchmarks' },
    date: { type: 'string', default: new Date().toISOString().slice(0, 10) },
    resume: { type: 'boolean', default: false },
    baseline: { type: 'string' },
    'report-only': { type: 'boolean', default: false },
    'build-style': { type: 'string', default: 'off' },
    placement: { type: 'string', default: 'jev' },
    split: { type: 'string', default: 'jev' },
    'no-ingest': { type: 'boolean', default: false },
  },
});

const buildStyle = buildStyleSchema.parse(values['build-style']);
const PLACEMENTS = ['jev', 'shared', 'worktree'] as const;
const SPLITS = ['jev', 'large', 'any'] as const;
const lanes: LaneOptions = {
  placement: PLACEMENTS.find((option) => option === values.placement) ?? 'jev',
  split: SPLITS.find((option) => option === values.split) ?? 'jev',
};

const out = resolve(values.out);
const date = values.date;
const files = {
  json: join(out, `harness-vs-direct-${date}.json`),
  md: join(out, `harness-vs-direct-${date}.md`),
  html: join(out, 'harness-vs-direct.html'),
};

async function readOptional(path: string): Promise<string | null> {
  return readFile(path, 'utf8').catch(() => null);
}

async function initialRun(): Promise<BenchRun> {
  const existing = values.resume || values['report-only'] ? await readOptional(files.json) : null;
  if (existing) return JSON.parse(existing) as BenchRun;
  return {
    version: 1,
    date,
    budgetUsd: Number(values.budget),
    spentUsd: 0,
    stoppedForBudget: false,
    settings: {
      direct: `One ${PINNED.provider} agent (Sonnet 5, ${PINNED.effort} effort) in Do mode, no orchestrator, no Jev.`,
      harness:
        'Full orchestrator on Auto routing with Jev intake: per-agent model routing, Architect / Builders / Critic as the depth requires, one Builder per run of sequential steps, parallel Builders in git worktree copies only for large independent steps.',
      level: `${BENCH_LEVEL} (tool approvals that still ask are auto-denied and recorded)`,
      fixture:
        'Ledger Lite, a 6-module TypeScript project tested with node --test (scripts/bench/fixture).',
      buildStyle,
      lanes: `placement ${lanes.placement}, split ${lanes.split}`,
    },
    results: [],
  };
}

async function readBaseline(): Promise<BenchRun | null> {
  if (!values.baseline) return null;
  const text = await readOptional(resolve(values.baseline));
  if (!text) throw new Error(`The baseline ${values.baseline} could not be read.`);
  return JSON.parse(text) as BenchRun;
}

async function writeOutputs(run: BenchRun): Promise<void> {
  const baseline = await readBaseline();
  await mkdir(out, { recursive: true });
  await writeFile(files.json, `${JSON.stringify(run, null, 2)}\n`);
  const analysis = preservedAnalysis(await readOptional(files.md));
  await writeFile(files.md, renderMarkdown(run, analysis, baseline));
  await writeFile(files.html, renderHtml(run, await readOptional(files.html), baseline));
}

function pending(run: BenchRun, tasks: BenchTask[], modes: BenchMode[], repeats: number) {
  const cells: { task: BenchTask; mode: BenchMode; repeat: number }[] = [];
  for (let repeat = 1; repeat <= repeats; repeat++) {
    for (const task of tasks) {
      for (const mode of modes) {
        const done = run.results.some(
          (result) => result.task === task.id && result.mode === mode && result.repeat === repeat,
        );
        if (!done) cells.push({ task, mode, repeat });
      }
    }
  }
  return cells;
}

async function runCell(
  env: Awaited<ReturnType<typeof startBench>>,
  task: BenchTask,
  mode: BenchMode,
  repeat: number,
): Promise<CellResult> {
  const repo = await createTaskRepo(
    task,
    join(resolve(values.dir), `${date}-${task.folder}-${mode}-${repeat}-${Date.now()}`),
  );
  const before = await precheck(task, repo);
  const startedAt = new Date().toISOString();
  const live = await runLiveCell(env, mode, repo.path, task.prompt, CELL_TIMEOUT_MS, buildStyle);
  const verification = await verifyRepo(task, repo, before);
  const agentCostUsd = live.agents.reduce((sum, agent) => sum + agent.costUsd, 0);
  return {
    task: task.id,
    mode,
    repeat,
    runId: live.runId,
    status: live.status,
    error: live.error,
    startedAt,
    wallMs: live.wallMs,
    activeMs: live.activeMs,
    agents: live.agents,
    toolCalls: live.toolCalls,
    retries: live.retries,
    agentCostUsd,
    jevCostUsd: live.jevCostUsd,
    jevCalls: live.jevCalls,
    costUsd: agentCostUsd + live.jevCostUsd,
    asked: live.asked,
    verification,
    routing: live.routing,
  };
}

async function main(): Promise<void> {
  const run = await initialRun();
  if (values['report-only']) {
    await writeOutputs(run);
    console.log(`Wrote ${files.md} and ${files.html}.`);
    return;
  }
  run.budgetUsd = Number(values.budget);
  run.stoppedForBudget = false;
  const tasks = values.tasks.split(',').map(taskById);
  const modes = values.modes.split(',').map((mode) => {
    if (mode !== 'direct' && mode !== 'harness') throw new Error(`Unknown mode ${mode}.`);
    return mode;
  });
  const queue = pending(run, tasks, modes, Number(values.repeats));
  const runtime = process.env.SPARK_BENCH_RUNTIME === 'fake' ? 'fake' : 'acp';
  const env = await startBench(PER_RUN_CAP_USD, runtime, lanes);
  try {
    for (const { task, mode, repeat } of queue) {
      const projected = projectedCostUsd(run.results, task.id, mode, FALLBACK_COST_USD[mode]);
      if (run.spentUsd + projected > run.budgetUsd) {
        run.stoppedForBudget = true;
        console.log(
          `Stopping before ${task.id} ${mode} #${repeat}: spent $${run.spentUsd.toFixed(3)}, next run could cost $${projected.toFixed(3)}.`,
        );
        break;
      }
      console.log(`Running ${task.id} ${mode} #${repeat}…`);
      const result = await runCell(env, task, mode, repeat);
      run.results.push(result);
      run.spentUsd += result.costUsd;
      console.log(
        `  ${result.verification.passed ? 'PASS' : 'FAIL'} ${(result.wallMs / 1000).toFixed(1)} s $${result.costUsd.toFixed(4)} agents=${result.agents.length} spent=$${run.spentUsd.toFixed(3)}${result.verification.passed ? '' : ` ${result.verification.reasons.join(' ')}`}`,
      );
      await writeOutputs(run);
    }
  } finally {
    await stopBench(env);
  }
  await writeOutputs(run);
  console.log(`Spent $${run.spentUsd.toFixed(3)}. Results in ${files.json}.`);
  await ingestStats();
}

async function ingestStats(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (values['no-ingest'] || !url) return;
  const db = createDb(url);
  try {
    await ingestFiles(db, [files.json]);
  } catch (error) {
    console.log(`Model stats not recorded: ${(error as Error).message}`);
  } finally {
    await db.end();
  }
}

await main();
