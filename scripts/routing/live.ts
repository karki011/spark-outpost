import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { indexProject } from '../../apps/server/src/codescan/indexer.ts';
import { stopParseWorker } from '../../apps/server/src/codescan/parse-pool.ts';
import { createDb, type Db } from '../../apps/server/src/persistence/db.ts';
import { runMigrations } from '../../apps/server/src/persistence/migrate.ts';
import { routingLabels } from '../../apps/server/src/persistence/routing-labels.ts';
import { filesAtK, toLabel } from '../../apps/server/src/routing/labels.ts';
import { REQUESTS } from '../codescan/requests.ts';
import { Api, sendApiTurn, sleep } from '../e2e-live/api-driver.ts';
import { seedWorkspace, setConnections } from '../e2e-live/seed.ts';
import {
  API_TOKEN_ENV,
  API_TOKEN_HEADER,
  modeForLegacy,
} from '../../packages/contracts/src/index.ts';
import { answers, startProcess, stopProcess, waitFor } from '../e2e-live/stack.ts';

const { values } = parseArgs({
  options: {
    repo: { type: 'string' },
    out: { type: 'string', default: 'routing-live.json' },
    limit: { type: 'string', default: '10' },
    model: { type: 'string', default: 'sonnet' },
    port: { type: 'string', default: '4471' },
    'run-cap': { type: 'string', default: '0.3' },
    'total-cap': { type: 'string', default: '2.6' },
    skip: { type: 'string', default: '0' },
    'timeout-min': { type: 'string', default: '8' },
    check: { type: 'string', multiple: true, default: [] },
  },
});

const ROOT = resolve(import.meta.dirname, '../..');
const repo = resolve(values.repo ?? '');
if (!values.repo || !existsSync(join(repo, '.git'))) throw new Error('Pass --repo <git clone>.');
if (existsSync(join(ROOT, '.local/credentials.env'))) {
  process.loadEnvFile(join(ROOT, '.local/credentials.env'));
}
const url = process.env.TEST_DATABASE_URL;
if (!url || !/\/\w*_test\w*$/.test(url))
  throw new Error('TEST_DATABASE_URL must name a *_test database.');

const schema = `route_live_${Date.now()}`;

interface Task {
  index: number;
  request: string;
  runId: string;
  wallMs: number;
  timedOut: boolean;
  changed: string[];
  agentUsd: number;
  jevUsd: number;
}
const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });

function changedFiles(): string[] {
  git('add', '-A');
  const listed = git('diff', '--cached', '--name-only', '--no-renames').trim();
  return listed ? listed.split('\n').sort() : [];
}

function commitAll(index: number): void {
  git(
    '-c',
    'user.email=live@route.test',
    '-c',
    'user.name=route live',
    'commit',
    '-qm',
    `task ${index}`,
    '--allow-empty',
  );
}

function renamesLast(requests: readonly string[]): string[] {
  const renames = requests.filter((request) => request.startsWith('Rename'));
  return [...requests.filter((request) => !renames.includes(request)), ...renames];
}

async function spentUsd(db: Db, runId?: string): Promise<number> {
  const { rows } = await db.query<{ spent: string }>(
    `SELECT COALESCE(sum(cost_usd), 0) AS spent FROM runs
     WHERE $1::uuid IS NULL OR id = $1 OR parent_run_id = $1`,
    [runId ?? null],
  );
  return Number(rows[0]?.spent ?? 0);
}

async function jevUsd(db: Db, runId: string): Promise<number> {
  const { rows } = await db.query<{ spent: string }>(
    'SELECT COALESCE(sum(jev_cost_usd), 0) AS spent FROM run_advice WHERE run_id = $1',
    [runId],
  );
  return Number(rows[0]?.spent ?? 0);
}

async function prepare(): Promise<{ db: Db; workspaceId: string; databaseUrl: string }> {
  const admin = createDb(url!, { max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.end();
  const db = createDb(url!, { searchPath: schema, max: 4 });
  await runMigrations(db);
  const workspaceId = await seedWorkspace(db);
  await setConnections(db, workspaceId, { jev: true, codex: false, zai: false });
  const indexed = await indexProject(db, repo);
  console.error(`Indexed ${repo}: ${JSON.stringify(indexed)}`);
  const databaseUrl = new URL(url!);
  databaseUrl.searchParams.set('options', `-c search_path=${schema}`);
  return { db, workspaceId, databaseUrl: databaseUrl.toString() };
}

async function main() {
  const logs = join(dirname(resolve(values.out)), 'logs');
  await mkdir(logs, { recursive: true });
  const { db, databaseUrl } = await prepare();
  const port = Number(values.port);
  const token = randomBytes(32).toString('hex');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    API_PORT: String(port),
    ALLOWED_ORIGINS: `http://127.0.0.1:${port + 1}`,
    AGENT_RUNTIME: 'acp',
    ORCHESTRATION_COST_CAP_USD: values['run-cap'],
    [API_TOKEN_ENV]: token,
  };
  delete env.TEST_DATABASE_URL;
  const server = join(ROOT, 'apps/server');
  const api = startProcess('api', ['--import', 'tsx', 'src/api/main.ts'], server, env, logs);
  const worker = startProcess(
    'worker',
    ['--import', 'tsx', 'src/workflow/main.ts'],
    server,
    env,
    logs,
  );
  const client = new Api(`http://127.0.0.1:${port}/api`, token);
  const tasks: Task[] = [];
  try {
    await waitFor(
      answers(`http://127.0.0.1:${port}/api/health`, { [API_TOKEN_HEADER]: token }),
      'The API',
    );
    await waitFor(async () => /Worker running/.test(worker.output()), 'The worker');
    const projectId = await client.linkProject(
      repo,
      'off',
      values.check.length > 0 ? values.check : undefined,
    );
    const requests = renamesLast(REQUESTS['feature-web-apps']!)
      .slice(0, Number(values.limit))
      .slice(Number(values.skip));
    for (const [offset, request] of requests.entries()) {
      const index = offset + Number(values.skip);
      const spent = await spentUsd(db);
      if (spent >= Number(values['total-cap'])) {
        console.error(`Stopping before task ${index + 1}: $${spent.toFixed(2)} spent.`);
        break;
      }
      const conversationId = randomUUID();
      await client.call('PATCH', `/conversations/${conversationId}/settings`, {
        projectIds: [projectId],
        provider: 'claude',
        agentMode: modeForLegacy('claude', 'do', 'full-auto'),
        level: 'full-auto',
        routing: 'auto',
        model: values.model,
      });
      const chat = { conversationId, projectId, repo };
      const outcome = await sendApiTurn(client, chat, request, {
        timeoutMs: Number(values['timeout-min']) * 60_000,
        cancelAfterBuilderMs: null,
        builderStartedAt: async () => null,
      });
      await sleep(2_000);
      const changed = changedFiles();
      commitAll(index + 1);
      const task: Task = {
        index: index + 1,
        request,
        runId: outcome.runId,
        wallMs: outcome.wallMs,
        timedOut: outcome.timedOut,
        changed,
        agentUsd: await spentUsd(db, outcome.runId),
        jevUsd: await jevUsd(db, outcome.runId),
      };
      tasks.push(task);
      console.error(JSON.stringify(task));
    }
    const rows = await routingLabels(db);
    const joined = tasks.map((task) => {
      const row = rows.find((entry) => entry.run_id === task.runId);
      return {
        ...task,
        label: row ? toLabel(row) : null,
        filesAt5: row ? filesAtK(row, task.changed) : null,
      };
    });
    await writeFile(values.out, `${JSON.stringify({ schema, repo, tasks: joined }, null, 2)}\n`);
    console.error(`Wrote ${values.out}. Total agent spend $${(await spentUsd(db)).toFixed(3)}.`);
  } finally {
    await stopProcess(worker.child);
    await stopProcess(api.child);
    await db.end();
    await stopParseWorker();
  }
}

await main();
