import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { indexProject, type IndexOutcome } from '../../apps/server/src/codescan/indexer.ts';
import { renderJevState } from '../../apps/server/src/codescan/jev-state.ts';
import { stopParseWorker } from '../../apps/server/src/codescan/parse-pool.ts';
import {
  createCodeScanner,
  SCAN_DEADLINE_MS,
  type ScanOutcome,
} from '../../apps/server/src/codescan/scanner.ts';
import { createDb, type Db } from '../../apps/server/src/persistence/db.ts';
import { runMigrations } from '../../apps/server/src/persistence/migrate.ts';
import { percentile, underLoad } from './load.ts';
import { REQUESTS } from './requests.ts';

const { values } = parseArgs({
  options: {
    repo: { type: 'string', multiple: true, default: [] },
    phases: { type: 'string', default: 'index,scan,concurrent' },
    repeats: { type: 'string', default: '3' },
    rounds: { type: 'string', default: '10' },
    out: { type: 'string', default: 'codescan-bench.json' },
  },
});

if (existsSync('.local/credentials.env')) process.loadEnvFile('.local/credentials.env');
const url = process.env.TEST_DATABASE_URL;
if (!url || !/\/[\w]*_test[\w]*$/.test(url)) {
  throw new Error('The benchmark needs TEST_DATABASE_URL pointing at a *_test database.');
}

interface Repo {
  name: string;
  root: string;
}

const repos: Repo[] = (values.repo ?? []).map((entry) => {
  const [name, root] = entry.split('=');
  if (!name || !root) throw new Error(`Use --repo name=/path, got ${entry}`);
  return { name, root };
});
const phases = new Set(values.phases.split(','));
const repeats = Number(values.repeats);
const rounds = Number(values.rounds);
const results: Record<string, unknown> = {};

const adminDb = createDb(url, { max: 1 });

async function admin(sql: string): Promise<void> {
  await adminDb.query(sql);
}

async function freshSchema(schema: string): Promise<Db> {
  await admin(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin(`CREATE SCHEMA ${schema}`);
  const db = createDb(url as string, { searchPath: schema, max: 6 });
  await runMigrations(db);
  return db;
}

function schemaFor(name: string): string {
  return `bench_cs_${name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
}

async function cacheSize(db: Db) {
  const { rows } = await db.query<{ total: string; rows: string; files: number; names: number }>(
    `SELECT (pg_total_relation_size('code_index_files') + pg_total_relation_size('code_index_names')
       + pg_total_relation_size('code_index_projects'))::bigint AS total,
       (SELECT sum(bytes) FROM code_index_projects)::bigint AS rows,
       (SELECT count(*)::int FROM code_index_files) AS files,
       (SELECT count(*)::int FROM code_index_names) AS names`,
  );
  const row = rows[0];
  const mb = (bytes: string | undefined) => Math.round((Number(bytes ?? 0) / 1048576) * 10) / 10;
  return { totalMb: mb(row?.total), rowMb: mb(row?.rows), files: row?.files, names: row?.names };
}

async function indexPhase(repo: Repo) {
  const db = await freshSchema(schemaFor(repo.name));
  try {
    await admin('CHECKPOINT');
    const cold: IndexOutcome = await indexProject(db, repo.root);
    const warm = await indexProject(db, repo.root);
    const size = await cacheSize(db);
    const perFileKb = size.files ? Math.round(((size.totalMb * 1024) / size.files) * 100) / 100 : 0;
    return { cold, warmRefreshMs: warm.ms, warmParsed: warm.parsed, size, perFileKb };
  } finally {
    await db.end();
  }
}

function topFiles(outcome: ScanOutcome, count = 10) {
  return (outcome.report?.candidates ?? []).slice(0, count).map((file) => ({
    path: file.path,
    score: file.score,
    why: file.reasons.join(', '),
  }));
}

async function scanPhase(repo: Repo) {
  const db = createDb(url as string, { searchPath: schemaFor(repo.name), max: 6 });
  const scanner = createCodeScanner(db, { deadlineMs: 10_000, refreshEveryMs: Infinity });
  const times: number[] = [];
  const samples = [];
  try {
    await scanner.ensureIndexed(repo.root);
    for (const request of REQUESTS[repo.name] ?? []) {
      const runs: ScanOutcome[] = [];
      for (let attempt = 0; attempt < repeats; attempt += 1)
        runs.push(await scanner.scan(repo.root, request));
      times.push(...runs.map((run) => run.elapsedMs));
      const first = runs[0] as ScanOutcome;
      const state = first.report ? renderJevState(first.report) : null;
      samples.push({
        request,
        status: first.status,
        ms: runs.map((run) => run.elapsedMs),
        timings: first.report?.timings ?? null,
        terms: first.report?.terms ?? null,
        candidates: first.report?.candidates.length ?? 0,
        packages: first.report?.summary.packagesTouched.length ?? 0,
        named: first.report?.summary.namedSymbols ?? [],
        jevStateTokens: state?.tokens ?? 0,
        jevStateFiles: state?.files ?? 0,
        top: topFiles(first),
      });
    }
  } finally {
    await db.end();
  }
  return {
    p50Ms: percentile(times, 0.5),
    p95Ms: percentile(times, 0.95),
    maxMs: Math.max(0, ...times),
    over1500: times.filter((ms) => ms > 1500).length,
    runs: times.length,
    samples,
  };
}

async function concurrentIndex(db: Db) {
  const scanner = createCodeScanner(db);
  const started = performance.now();
  const { result, api } = await underLoad(async () =>
    Promise.all(repos.map((repo) => scanner.ensureIndexed(repo.root))),
  );
  return {
    ms: Math.round(performance.now() - started),
    perRepo: result.map((outcome, index) => ({
      repo: repos[index]?.name,
      ms: outcome?.ms,
      parsed: outcome?.parsed,
    })),
    api,
  };
}

async function concurrentScans(db: Db, deadlineMs: number) {
  const scanner = createCodeScanner(db, { deadlineMs, refreshEveryMs: Infinity });
  const statuses: Record<string, number> = {};
  const times: number[] = [];
  const queued: number[] = [];
  await Promise.all(repos.map((repo) => scanner.ensureIndexed(repo.root)));
  const { api } = await underLoad(async () => {
    for (let round = 0; round < rounds; round += 1) {
      const outcomes = await Promise.all(
        repos.map((repo) => {
          const list = REQUESTS[repo.name] ?? ['Fix the bug'];
          return scanner.scan(repo.root, list[round % list.length] as string);
        }),
      );
      for (const outcome of outcomes) {
        statuses[outcome.status] = (statuses[outcome.status] ?? 0) + 1;
        times.push(outcome.elapsedMs);
        queued.push(outcome.queuedMs);
      }
    }
  });
  return {
    deadlineMs,
    p50Ms: percentile(times, 0.5),
    p95Ms: percentile(times, 0.95),
    queuedP95Ms: percentile(queued, 0.95),
    statuses,
    api,
  };
}

async function concurrentPhase() {
  const db = await freshSchema('bench_cs_all');
  try {
    const { api: idle } = await underLoad(
      () => new Promise((resolve) => setTimeout(resolve, 5000)),
    );
    const indexing = await concurrentIndex(db);
    const raw = await concurrentScans(db, 10_000);
    const real = await concurrentScans(db, SCAN_DEADLINE_MS);
    return { idle, indexing, raw, real };
  } finally {
    await db.end();
  }
}

function logStep(label: string, value: unknown): void {
  console.log(`\n## ${label}\n${JSON.stringify(value, null, 1)}`);
}

try {
  for (const repo of repos) {
    const entry: Record<string, unknown> = {};
    if (phases.has('index')) entry.index = await indexPhase(repo);
    if (phases.has('scan')) entry.scan = await scanPhase(repo);
    results[repo.name] = entry;
    logStep(repo.name, entry);
    await writeFile(values.out, JSON.stringify(results, null, 1));
  }
  if (phases.has('concurrent')) {
    results.concurrent = await concurrentPhase();
    logStep('concurrent', results.concurrent);
  }
  await writeFile(values.out, JSON.stringify(results, null, 1));
} finally {
  await stopParseWorker();
  await adminDb.end();
}
