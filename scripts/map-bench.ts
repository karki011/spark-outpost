import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { appendFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { stopParseWorker } from '../apps/server/src/codescan/parse-pool.ts';
import { createCodeScanner } from '../apps/server/src/codescan/scanner.ts';
import { createMapBuilder } from '../apps/server/src/map/scheduler.ts';
import { queueRepo } from '../apps/server/src/map/store.ts';
import { ensureLocalWorkspace } from '../apps/server/src/persistence/conversations.ts';
import { createDb, type Db } from '../apps/server/src/persistence/db.ts';
import { runMigrations } from '../apps/server/src/persistence/migrate.ts';
import { keychainSecretStore } from '../apps/server/src/setup/secrets.ts';
import { testDatabaseUrl } from './test-database.ts';

const { values } = parseArgs({
  options: {
    repo: { type: 'string', multiple: true, default: [] },
    budget: { type: 'string', default: '1' },
    jev: { type: 'boolean', default: false },
    touch: { type: 'string', multiple: true, default: [] },
    out: { type: 'string', default: 'map-bench.json' },
  },
});

if (existsSync('.local/credentials.env')) process.loadEnvFile('.local/credentials.env');
const url = testDatabaseUrl();
const SCHEMA = 'bench_project_map';

async function freshDb(): Promise<Db> {
  const admin = createDb(url, { max: 1 });
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.end();
  const db = createDb(url, { searchPath: SCHEMA, max: 6 });
  await runMigrations(db);
  return db;
}

async function measure<T>(work: () => Promise<T>) {
  const cpu = process.cpuUsage();
  const started = performance.now();
  let peakRss = process.memoryUsage().rss;
  const sampler = setInterval(() => {
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  }, 50);
  try {
    const result = await work();
    const used = process.cpuUsage(cpu);
    const wallMs = Math.round(performance.now() - started);
    return {
      result,
      wallMs,
      cpuMs: Math.round((used.user + used.system) / 1000),
      cpuShare: Math.round(((used.user + used.system) / 1000 / wallMs) * 100) / 100,
      peakRssMb: Math.round(peakRss / 1048576),
    };
  } finally {
    clearInterval(sampler);
  }
}

async function repoState(db: Db, root: string) {
  const { rows } = await db.query(
    `SELECT id, status, file_count, area_count, edge_count, timings, error FROM map_repos
     WHERE root_path = $1`,
    [root],
  );
  return rows[0] as { id: string; timings: Record<string, number> } & Record<string, unknown>;
}

async function jevSpend(db: Db) {
  const { rows } = await db.query<{ calls: number; tokens: number; cost: string }>(
    `SELECT count(*)::int AS calls, COALESCE(sum(input_tokens), 0)::int AS tokens,
       COALESCE(sum(cost_usd), 0)::text AS cost FROM map_jev_calls`,
  );
  return rows[0];
}

const db = await freshDb();
const workspaceId = await ensureLocalWorkspace(db);
if (values.jev) {
  await db.query(
    `INSERT INTO advisor_connections (workspace_id, advisor, method, detail, verified_at)
     VALUES ($1, 'jev', 'api_key', 'bench', now())`,
    [workspaceId],
  );
}
const scanner = createCodeScanner(db);
const builder = createMapBuilder({
  db,
  scanner,
  jev: values.jev
    ? {
        db,
        secrets: keychainSecretStore(),
        fetch,
        baseUrl: process.env.TYPESAFE_BASE_URL ?? 'https://api.typesafe.ai',
      }
    : null,
  budget: Number(values.budget),
  pollMs: 200,
});
const results: Record<string, unknown> = {};

async function touched(name: string, root: string) {
  const path = (values.touch ?? [])
    .find((entry) => entry.startsWith(`${name}=`))
    ?.slice(name.length + 1);
  if (!path) return {};
  await appendFile(join(root, path), '\nexport const benchTouch = 1;\n');
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', root, '-c', 'user.email=b@b', '-c', 'user.name=b', ...args]);
  git('add', path);
  git('commit', '-qm', 'bench touch');
  await db.query(`UPDATE map_repos SET checked_at = NULL WHERE root_path = $1`, [root]);
  const incremental = await measure(() => builder.runOnce());
  return { incremental: { ...incremental, timings: (await repoState(db, root)).timings } };
}
for (const entry of values.repo ?? []) {
  const [name, root] = entry.split('=');
  if (!name || !root) throw new Error(`Use --repo name=/path, got ${entry}`);
  await db.query(
    'INSERT INTO projects (id, workspace_id, name, root_path) VALUES ($1, $2, $3, $4)',
    [randomUUID(), workspaceId, name, root],
  );
  const full = await measure(() => builder.runOnce());
  const built = await repoState(db, root);
  await queueRepo(db, built.id, 'bench-rebuild');
  const again = await measure(() => builder.runOnce());
  const unchanged = (await repoState(db, root)).timings;
  results[name] = {
    full: { ...full, timings: built.timings },
    unchangedRebuild: { ...again, timings: unchanged },
    ...(await touched(name, root)),
    map: await repoState(db, root),
  };
  console.log(name, JSON.stringify(results[name], null, 2));
}
results.jev = await jevSpend(db);
console.log('jev', results.jev);
await writeFile(values.out, JSON.stringify(results, null, 2));
builder.stop();
await scanner.idle();
await stopParseWorker();
await db.end();
