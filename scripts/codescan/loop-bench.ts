import { existsSync } from 'node:fs';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import { indexProject } from '../../apps/server/src/codescan/indexer.ts';
import { stopParseWorker } from '../../apps/server/src/codescan/parse-pool.ts';
import { createCodeScanner, type CodeScanner } from '../../apps/server/src/codescan/scanner.ts';
import {
  CODE_CONTEXT,
  excerptTargets,
  renderCodeContext,
} from '../../apps/server/src/find/context-block.ts';
import { readExcerpts } from '../../apps/server/src/find/excerpts.ts';
import { codeLeads } from '../../apps/server/src/find/leads.ts';
import { findIssues, findStatus } from '../../apps/server/src/find/status.ts';
import { createDb, type Db } from '../../apps/server/src/persistence/db.ts';
import { runMigrations } from '../../apps/server/src/persistence/migrate.ts';
import { testDatabaseUrl } from '../test-database.ts';
import { percentile } from './load.ts';
import { REQUESTS } from './requests.ts';

const { values } = parseArgs({
  options: {
    repo: { type: 'string', default: process.cwd() },
    name: { type: 'string', default: 'spark-outpost' },
    'max-lag-p99': { type: 'string', default: '50' },
    'max-find-p95': { type: 'string', default: '2500' },
    keep: { type: 'boolean', default: false },
  },
});

if (existsSync('.local/credentials.env')) process.loadEnvFile('.local/credentials.env');
const url = testDatabaseUrl();
const root = values.repo;
const requests = REQUESTS[values.name] ?? REQUESTS['spark-outpost'] ?? [];
const schema = `bench_loop_${values.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
const RESOLUTION_MS = 5;

interface Lag {
  p50Ms: number;
  p99Ms: number;
  maxMs: number;
  peakRssMb: number;
  ms: number;
}

async function measured<T>(work: () => Promise<T>): Promise<{ result: T; lag: Lag }> {
  const delay = monitorEventLoopDelay({ resolution: RESOLUTION_MS });
  let peak = process.memoryUsage.rss();
  const sampler = setInterval(() => {
    peak = Math.max(peak, process.memoryUsage.rss());
  }, 100);
  const started = performance.now();
  delay.enable();
  try {
    const result = await work();
    const beyond = (ns: number) => Math.max(0, Math.round((ns / 1e6 - RESOLUTION_MS) * 10) / 10);
    return {
      result,
      lag: {
        p50Ms: beyond(delay.percentile(50)),
        p99Ms: beyond(delay.percentile(99)),
        maxMs: beyond(delay.max),
        peakRssMb: Math.round(peak / 1048576),
        ms: Math.round(performance.now() - started),
      },
    };
  } finally {
    delay.disable();
    clearInterval(sampler);
  }
}

async function find(db: Db, scanner: CodeScanner, request: string) {
  const started = performance.now();
  const outcome = await scanner.scan(root, request);
  const scanMs = performance.now() - started;
  if (!outcome.report) return { scanMs, totalMs: scanMs, status: outcome.status, tokens: 0 };
  const found = await codeLeads(db, root, outcome.report, {
    ignore: [],
    limit: CODE_CONTEXT.files,
    declarations: CODE_CONTEXT.declarationsPerFile,
  });
  const excerpts = await readExcerpts(root, excerptTargets(found.leads), []);
  const block = renderCodeContext({
    status: findStatus(outcome, found),
    issues: findIssues(outcome, found),
    leads: found.leads,
    excerpts,
  });
  return {
    scanMs,
    totalMs: performance.now() - started,
    status: findStatus(outcome, found),
    tokens: block?.tokens ?? 0,
  };
}

type FindRun = Awaited<ReturnType<typeof find>>;

async function findsUntil(db: Db, scanner: CodeScanner, done: Promise<void>) {
  const runs: FindRun[] = [];
  let building = true;
  void done.then(() => {
    building = false;
  });
  for (let round = 0; building; round += 1) {
    runs.push(await find(db, scanner, requests[round % requests.length] ?? 'Fix the bug'));
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return summary(runs);
}

async function finds(db: Db, scanner: CodeScanner, rounds: number, parallel: number) {
  const runs: FindRun[] = [];
  for (let round = 0; round < rounds; round += 1) {
    const batch = Array.from({ length: parallel }, (_, index) =>
      find(db, scanner, requests[(round + index) % requests.length] ?? 'Fix the bug'),
    );
    runs.push(...(await Promise.all(batch)));
  }
  return summary(runs);
}

function summary(runs: readonly FindRun[]) {
  const statuses: Record<string, number> = {};
  for (const run of runs) statuses[run.status] = (statuses[run.status] ?? 0) + 1;
  return {
    runs: runs.length,
    scanP50Ms: percentile(
      runs.map((run) => run.scanMs),
      0.5,
    ),
    scanP95Ms: percentile(
      runs.map((run) => run.scanMs),
      0.95,
    ),
    totalP50Ms: percentile(
      runs.map((run) => run.totalMs),
      0.5,
    ),
    totalP95Ms: percentile(
      runs.map((run) => run.totalMs),
      0.95,
    ),
    maxTokens: Math.max(0, ...runs.map((run) => run.tokens)),
    statuses,
  };
}

const admin = createDb(url, { max: 1 });
await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
await admin.query(`CREATE SCHEMA ${schema}`);
const db = createDb(url, { searchPath: schema, max: 6 });
const failures: string[] = [];
const report: Record<string, unknown> = {};

function check(label: string, value: number, limit: number): void {
  if (value > limit) failures.push(`${label}: ${value} ms is over the ${limit} ms limit`);
}

try {
  await runMigrations(db);
  const maxLag = Number(values['max-lag-p99']);
  const maxFind = Number(values['max-find-p95']);
  const scanner = createCodeScanner(db);

  const idle = await measured(() => new Promise((resolve) => setTimeout(resolve, 2000)));
  report.idle = idle.lag;

  const cold = await measured(() => find(db, scanner, requests[0] ?? 'Fix the bug'));
  report.findBeforeIndex = { ...cold.result, lag: cold.lag };

  const during = await measured(() => findsUntil(db, scanner, scanner.idle()));
  report.findsWhileIndexBuilds = { ...during.result, lag: during.lag };

  const rebuild = await measured(() => indexProject(db, root, { parserVersion: 'bench-rebuild' }));
  report.fullRebuild = { outcome: rebuild.result, lag: rebuild.lag };

  const refresh = await measured(() => indexProject(db, root, { parserVersion: 'bench-rebuild' }));
  report.warmRefresh = { ms: refresh.result.ms, parsed: refresh.result.parsed, lag: refresh.lag };

  const again = await measured(() => indexProject(db, root));
  report.rebuildForScans = again.lag;

  const warm = await measured(() => finds(db, scanner, 10, 1));
  report.findsWarm = { ...warm.result, lag: warm.lag };

  const crowded = await measured(() => finds(db, scanner, 5, 8));
  report.findsEightAtOnce = { ...crowded.result, lag: crowded.lag };

  check('lag p99 while finding before the index exists', cold.lag.p99Ms, maxLag);
  check('lag p99 while finding during the index build', during.lag.p99Ms, maxLag);
  check('lag p99 during a full rebuild', rebuild.lag.p99Ms, maxLag);
  check('lag p99 during a warm refresh', refresh.lag.p99Ms, maxLag);
  check('lag p99 during warm finds', warm.lag.p99Ms, maxLag);
  check('lag p99 during eight finds at once', crowded.lag.p99Ms, maxLag);
  check('find p95 with a warm index', warm.result.totalP95Ms, maxFind);
  check('find p95 while the index builds', during.result.totalP95Ms, maxFind);
} finally {
  await stopParseWorker();
  await db.end();
  if (!values.keep) await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
}

console.log(JSON.stringify(report, null, 1));
if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
}
