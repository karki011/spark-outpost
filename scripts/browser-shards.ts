import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createDb } from '../apps/server/src/persistence/db.ts';
import { PERF_SPECS, specFile } from '../tests/browser/spec-map.ts';
import { slotTmpdir, WEB_BUILD_ENV } from '../tests/browser/stub-config.ts';
import { preflight } from './shard-preflight.ts';
import { describeBlocked, inspectSlot, stopGroups, stopLeftovers } from './slot-host.ts';
import {
  connectionShortfall,
  CONNECTIONS_PER_STACK,
  planShards,
  type ShardPlan,
} from './test-selection.ts';

if (!process.env.TEST_DATABASE_URL && existsSync('.local/credentials.env'))
  process.loadEnvFile('.local/credentials.env');

const DEFAULT_SHARDS = 6;
const ROOT = process.cwd();
const SHUTDOWN_GRACE_MS = 20_000;

interface Options {
  count: number;
  firstSlot: number;
  dryRun: boolean;
  filters: string[];
}

function parseOptions(args: string[]): Options {
  const flags = args.filter((arg) => arg.startsWith('--'));
  const positional = args.filter((arg) => !arg.startsWith('--'));
  const counted = /^\d+$/.test(positional[0] ?? '');
  const filters = counted ? positional.slice(1) : positional;
  const firstSlot = flags.find((flag) => flag.startsWith('--first-slot='))?.split('=')[1];
  return {
    count: counted ? Number(positional[0]) : DEFAULT_SHARDS,
    firstSlot: Number(firstSlot ?? 1),
    dryRun: flags.includes('--dry-run'),
    filters,
  };
}

function specsToRun(filters: string[]): string[] {
  const perf = new Set<string>(PERF_SPECS.map(specFile));
  return readdirSync('tests/browser')
    .filter((name) => name.endsWith('.spec.ts'))
    .map((name) => `tests/browser/${name}`)
    .filter((spec) => !perf.has(spec))
    .filter((spec) => filters.length === 0 || filters.some((filter) => spec.includes(filter)))
    .toSorted();
}

async function checkConnections(url: string, stacks: number): Promise<string | null> {
  const db = createDb(url, { max: 1 });
  try {
    const limit = await db.query<{ max_connections: string }>('SHOW max_connections');
    const used = await db.query<{ count: string }>('SELECT count(*) FROM pg_stat_activity');
    const max = Number(limit.rows[0]!.max_connections);
    const inUse = Number(used.rows[0]!.count);
    const short = connectionShortfall(stacks, max, inUse);
    console.log(
      `Postgres: max_connections ${max}, ${inUse} in use, ${stacks} stacks need up to ${stacks * CONNECTIONS_PER_STACK}.`,
    );
    return short > 0 ? `Postgres is ${short} connection(s) short for ${stacks} stacks.` : null;
  } finally {
    await db.end();
  }
}

function shardEnv(plan: ShardPlan): Record<string, string> {
  return {
    SPARK_TEST_PORT_SLOT: String(plan.slot),
    SPARK_WEB_BUILD: '1',
    SPARK_WEB_PREBUILT: '1',
  };
}

function describe(plan: ShardPlan, specs: string[]): void {
  const env = Object.entries(shardEnv(plan))
    .map(([name, value]) => `${name}=${value}`)
    .join(' ');
  console.log(
    `[shard ${plan.shard}] slot ${plan.slot}: stub ${plan.ports.stub}, api ${plan.ports.api}, web ${plan.ports.web}, database ${plan.database}, results test-results/slot-${plan.slot}`,
  );
  console.log(
    `[shard ${plan.shard}] ${env} pnpm exec playwright test --shard=${plan.shard} <${specs.length} specs>`,
  );
}

function buildWeb(): boolean {
  console.log('Building the web app once for every shard.');
  const built = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], {
    cwd: 'apps/web',
    env: { ...process.env, ...WEB_BUILD_ENV },
    stdio: 'inherit',
  });
  return built.status === 0;
}

function startShard(plan: ShardPlan, specs: string[]): ChildProcess {
  const child = spawn('pnpm', ['exec', 'playwright', 'test', `--shard=${plan.shard}`, ...specs], {
    env: { ...process.env, ...shardEnv(plan) },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  for (const stream of [child.stdout, child.stderr]) {
    createInterface({ input: stream }).on('line', (line) =>
      console.log(`[shard ${plan.shard}] ${line}`),
    );
  }
  return child;
}

function exitCode(child: ChildProcess): Promise<number> {
  return new Promise((resolve) => child.on('close', (code) => resolve(code ?? 1)));
}

async function clearSlots(plans: ShardPlan[], dryRun: boolean): Promise<boolean> {
  const decisions = plans.map((plan) => ({ plan, decision: inspectSlot(plan, ROOT) }));
  const blocked = decisions.filter(({ decision }) => decision.blocked.length > 0);
  for (const { plan, decision } of blocked) console.error(describeBlocked(plan, decision));
  if (blocked.length > 0) {
    console.error(
      'Stop those processes yourself, or pick free slots with --first-slot=N. Nothing outside this checkout is stopped.',
    );
    return false;
  }
  for (const { plan, decision } of decisions) {
    if (dryRun && decision.stop.length > 0)
      console.log(
        `[slot ${plan.slot}] ${decision.stop.length} leftover test server(s) would be stopped.`,
      );
    else await stopLeftovers(plan, decision);
  }
  return true;
}

async function tidyAfterRun(plans: ShardPlan[]): Promise<void> {
  for (const plan of plans) {
    const decision = inspectSlot(plan, ROOT);
    await stopLeftovers(plan, { stop: decision.stop, blocked: [] });
    removeSlotTmpdir(plan.slot);
  }
}

function removeSlotTmpdir(slot: number): void {
  const folder = slotTmpdir(slot);
  try {
    rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (error) {
    console.warn(`[slot ${slot}] Could not remove ${folder}: ${(error as Error).message}`);
  }
}

function forwardToGroups(pids: readonly number[], signal: NodeJS.Signals): void {
  for (const pid of pids) {
    try {
      process.kill(-pid, signal);
    } catch {
      continue;
    }
  }
}

function stopOnSignal(children: ChildProcess[]): void {
  const groups = children.map((child) => child.pid!);
  let signalled = false;
  let forced = false;
  const force = () => {
    if (forced) return;
    forced = true;
    void stopGroups(groups);
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(signal, () => {
      if (signalled) return force();
      signalled = true;
      console.log(`Stopping every shard (${signal}); a second signal stops them at once.`);
      forwardToGroups(groups, signal === 'SIGHUP' ? 'SIGTERM' : signal);
      setTimeout(force, SHUTDOWN_GRACE_MS).unref();
    });
  }
}

async function main(): Promise<number> {
  const options = parseOptions(process.argv.slice(2));
  const url = process.env.TEST_DATABASE_URL;
  if (!Number.isInteger(options.count) || !url) {
    console.error(
      'Usage: tsx scripts/browser-shards.ts [shards, default 6] [spec filter...] [--first-slot=N] [--dry-run] (needs TEST_DATABASE_URL)',
    );
    return 2;
  }
  const specs = specsToRun(options.filters);
  if (specs.length === 0) {
    console.error('No specs match.');
    return 2;
  }
  const plans = planShards(Math.min(options.count, specs.length), options.firstSlot, url);
  for (const plan of plans) describe(plan, specs);
  const ready = await preflight({
    clearSlots: () => clearSlots(plans, options.dryRun),
    connectionShortage: () => checkConnections(url, plans.length),
  });
  if (ready.kind === 'blocked') return 1;
  if (options.dryRun) {
    if (ready.kind === 'short')
      console.log(`${ready.shortage} (measured before stopping any leftover test servers)`);
    console.log('Dry run: nothing was built or started.');
    return 0;
  }
  if (ready.kind === 'short') {
    console.error(`${ready.shortage} Use fewer shards or stop other test runs.`);
    return 1;
  }
  if (!buildWeb()) return 1;
  const children = plans.map((plan) => startShard(plan, specs));
  stopOnSignal(children);
  const codes = await Promise.all(children.map(exitCode));
  await tidyAfterRun(plans);
  plans.forEach((plan, index) =>
    console.log(
      `[shard ${plan.shard}] ${codes[index] === 0 ? 'passed' : `failed (${codes[index]})`}`,
    ),
  );
  return codes.every((code) => code === 0) ? 0 : 1;
}

process.exit(await main());
