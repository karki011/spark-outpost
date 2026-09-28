import { spawnSync } from 'node:child_process';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Browser } from '@playwright/test';
import { connectableIdSchema } from '../../../packages/contracts/src/index.ts';
import { stopBench } from '../../bench/live.ts';
import { keychainSecretStore } from '../../../apps/server/src/setup/secrets.ts';
import { Api } from '../api-driver.ts';
import { benchEnv } from '../bench-env.ts';
import { hitRateLimit } from '../results.ts';
import type { BaseArm } from '../scenario-types.ts';
import { startStack, stopStack, type Runtime, type Stack } from '../stack.ts';
import { openBrowser } from '../ui-driver.ts';
import type { ArmDay } from './arm.ts';
import { DirectClaudeDay, DirectCodexDay } from './direct-day.ts';
import { FAKE_GITHUB_TOKEN, startGitHubStub, type GitHubStub } from './github-stub.ts';
import { HarnessDay } from './harness-day.ts';
import { DEFAULT_LEVEL, LEVELS, type LevelKey } from './levels.ts';
import { renderDayReport } from './report-day.ts';
import { FAKE_REMOTE_HOST, ROOT } from './repos.ts';
import type { Rates } from './score.ts';
import type { DaySession } from './session-types.ts';
import { SESSIONS } from './sessions.ts';
import { runSession, sessionCap, type ArmState, type DayRecord } from './session-run.ts';

export const DEV_DAY_HARD_CAP_USD = 25;

async function stackSecrets(runtime: Runtime): Promise<Record<string, string>> {
  const secrets: Record<string, string> = { github: FAKE_GITHUB_TOKEN };
  if (runtime === 'fake') return secrets;
  const keychain = keychainSecretStore();
  for (const id of connectableIdSchema.options) {
    const key = await keychain.get(id).catch(() => null);
    if (key) secrets[id] = key;
  }
  return secrets;
}

async function connectFakeGitHub(stack: Stack, ghHome: string, run: DayRun): Promise<void> {
  const api = new Api(stack.urls.api, stack.apiToken);
  const saved = await api.call<{ active: string | null; ghCli: { login: string | null } }>(
    'PUT',
    '/github/token',
    { token: FAKE_GITHUB_TOKEN, host: FAKE_REMOTE_HOST },
  );
  run.setup['github connection'] =
    `active ${saved.active ?? 'none'}; gh CLI login ${saved.ghCli.login ?? 'none'} (GH_CONFIG_DIR ${ghHome})`;
  const gh = spawnSync('gh', ['auth', 'status', '--hostname', 'github.com'], {
    env: { ...cleanGitHubEnv(), GH_CONFIG_DIR: ghHome },
    encoding: 'utf8',
  });
  run.setup['gh auth status (stack env)'] = gh.error
    ? `gh not found (${gh.error.message})`
    : `exit ${gh.status}: ${`${gh.stdout}${gh.stderr}`.trim().split('\n')[0]?.slice(0, 160) ?? ''}`;
}

const GITHUB_TOKEN_ENV = [
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'GH_ENTERPRISE_TOKEN',
  'GITHUB_ENTERPRISE_TOKEN',
];

function cleanGitHubEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of GITHUB_TOKEN_ENV) delete env[name];
  return env;
}
export const DAY_ARMS: readonly BaseArm[] = ['harness', 'direct-claude', 'direct-codex'];
const PROJECTION_FACTOR = 1.3;

export interface DayRun {
  version: 1;
  kind: 'dev-day';
  date: string;
  runtime: Runtime;
  budgetUsd: number;
  spentUsd: number;
  stopped: string | null;
  rates: Rates;
  arms: BaseArm[];
  levels: Record<string, string>;
  settings: Record<string, string>;
  setup: Record<string, string>;
  records: DayRecord[];
}

export interface DayOptions {
  runtime: Runtime;
  dir: string;
  label: string;
  budgetUsd: number;
  timeoutMs: number;
  arms: readonly BaseArm[];
  match: RegExp | null;
  shots: boolean;
  rates: Rates;
  keepData: boolean;
  dayLevel?: LevelKey | undefined;
}

export function projectedRound(session: DaySession, arms: readonly BaseArm[]): number {
  return arms.reduce((sum, arm) => sum + session.expectUsd[arm] * PROJECTION_FACTOR, 0);
}

async function save(options: DayOptions, run: DayRun): Promise<string> {
  const path = join(options.dir, `dev-day-${options.label}.json`);
  await writeFile(path, `${JSON.stringify(run, null, 2)}\n`);
  await writeFile(path.replace(/\.json$/, '.md'), renderDayReport(run));
  return path;
}

function daySessions(match: RegExp | null, dayLevel?: LevelKey): DaySession[] {
  return SESSIONS.filter((session) => !match || match.test(session.id)).map((session) =>
    dayLevel && session.level === DEFAULT_LEVEL ? { ...session, level: dayLevel } : session,
  );
}

function newRun(options: DayOptions): DayRun {
  return {
    version: 1,
    kind: 'dev-day',
    date: new Date().toISOString().slice(0, 10),
    runtime: options.runtime,
    budgetUsd: options.budgetUsd,
    spentUsd: 0,
    stopped: null,
    rates: options.rates,
    arms: [...options.arms],
    levels: Object.fromEntries(
      Object.entries(LEVELS).map(([key, value]) => [
        key,
        `${value.label} = permission ${value.permission}, level ${value.level}`,
      ]),
    ),
    settings: {
      harness:
        'The app (API + worker on their own schema) driven through its HTTP API as the web UI drives it: Auto routing with Jev, Claude provider, approvals answered like a Balanced user; stops on a clarify card only where the session says so.',
      'direct-claude':
        'scripts/bench direct arm: one Claude agent (Sonnet, medium) in Do mode, no orchestrator, no Jev; a thread keeps its agent session.',
      'direct-codex':
        'codex exec (gpt-6-sol, medium) in a workspace-write sandbox; a thread resumes its codex thread. Cost estimated from tokens.',
    },
    setup: options.dayLevel
      ? {
          'day level': `${LEVELS[options.dayLevel].label} for the harness (sessions at ${LEVELS[DEFAULT_LEVEL].label} moved to it; others keep theirs)`,
        }
      : {},
    records: [],
  };
}

function rateLimited(record: DayRecord): boolean {
  return hitRateLimit([record.evidence.error, ...record.turns.map((turn) => turn.error)]);
}

async function armDays(
  options: DayOptions,
  stub: GitHubStub,
  cleanups: (() => Promise<void>)[],
  run: DayRun,
): Promise<Map<BaseArm, ArmState>> {
  const states = new Map<BaseArm, ArmState>();
  const fresh = (day: ArmDay): ArmState => ({ day, repos: new Map(), replies: new Map() });
  if (options.arms.includes('harness')) {
    const maxCap = Math.max(...SESSIONS.map((session) => sessionCap(session, 'harness')));
    process.env.E2E_RUN_CAP_USD ??= String(maxCap);
    const ghHome = join(options.dir, 'gh-empty');
    await mkdir(ghHome, { recursive: true });
    if ((await readdir(ghHome)).length > 0) throw new Error(`${ghHome} must be empty.`);
    const secrets = await stackSecrets(options.runtime);
    const stack: Stack = await startStack(
      options.runtime,
      'current',
      ROOT,
      options.dir,
      options.shots,
      {
        env: {
          GITHUB_API_URL: stub.url,
          GH_CONFIG_DIR: ghHome,
          GIT_TERMINAL_PROMPT: '0',
          SECRET_STORE: 'memory',
          MEMORY_SECRETS: JSON.stringify(secrets),
        },
        unset: GITHUB_TOKEN_ENV,
        secrets: { github: FAKE_GITHUB_TOKEN },
      },
    );
    cleanups.push(() => stopStack(stack, options.keepData));
    await connectFakeGitHub(stack, ghHome, run);
    let browser: Browser | null = null;
    cleanups.push(async () => browser?.close());
    const day = new HarnessDay(stack, {
      timeoutMs: options.timeoutMs,
      shotsDir: options.shots ? join(options.dir, 'shots') : null,
      browser: options.shots ? async () => (browser ??= await openBrowser()) : null,
    });
    states.set('harness', fresh(day));
  }
  if (options.arms.includes('direct-claude')) {
    const env = await benchEnv(options.runtime);
    cleanups.push(() => stopBench(env));
    states.set('direct-claude', fresh(new DirectClaudeDay(env, options.timeoutMs)));
  }
  if (options.arms.includes('direct-codex')) {
    states.set('direct-codex', fresh(new DirectCodexDay(options.timeoutMs)));
  }
  return states;
}

export async function runDevDay(options: DayOptions): Promise<DayRun> {
  if (options.budgetUsd > DEV_DAY_HARD_CAP_USD) {
    throw new Error(`The dev-day budget is capped at $${DEV_DAY_HARD_CAP_USD}.`);
  }
  await mkdir(join(options.dir, 'shots'), { recursive: true });
  const run = newRun(options);
  const stub = await startGitHubStub();
  const cleanups: (() => Promise<void>)[] = [async () => stub.close()];
  try {
    const states = await armDays(options, stub, cleanups, run);
    const sessions = daySessions(options.match, options.dayLevel);
    outer: for (const session of sessions) {
      const projected = projectedRound(session, options.arms);
      if (options.runtime === 'acp' && run.spentUsd + projected > options.budgetUsd) {
        run.stopped = `Stopped before ${session.id}: spent $${run.spentUsd.toFixed(3)}, the next round could cost $${projected.toFixed(3)}.`;
        console.log(run.stopped);
        break;
      }
      for (const arm of options.arms) {
        const state = states.get(arm)!;
        console.log(`Running ${session.id} (${session.title}) on ${arm}…`);
        const record = await runSession(options, session, state, stub);
        run.records.push(record);
        run.spentUsd += record.costUsd;
        for (const repo of state.repos.values()) {
          if (repo.install)
            run.setup[`${arm} ${repo.key} install`] =
              `${repo.install.ms} ms${repo.install.error ? ` (${repo.install.error})` : ''}`;
        }
        const verdict = record.score.passed ? 'PASS' : 'FAIL';
        const why = record.score.checks
          .filter((check) => check.ok === false)
          .map((check) => `${check.id}: ${check.detail}`)
          .join('; ');
        console.log(
          `  ${verdict} ${record.score.kind} ${(record.wallMs / 1000).toFixed(1)} s $${record.costUsd.toFixed(4)} spent=$${run.spentUsd.toFixed(3)} ${why.slice(0, 300)}`,
        );
        await save(options, run);
        if (rateLimited(record)) {
          run.stopped = `Paused after ${session.id} on ${arm}: an agent hit a rate or usage limit.`;
          console.log(run.stopped);
          break outer;
        }
      }
    }
  } finally {
    run.setup['github stub requests'] = String(stub.requests.length);
    run.setup['github stub foreign credentials'] =
      stub.foreignCredentials.length === 0 ? 'none' : stub.foreignCredentials.join('; ');
    for (const cleanup of cleanups.reverse()) await cleanup().catch(() => undefined);
    const path = await save(options, run);
    console.log(`Spent $${run.spentUsd.toFixed(3)}. Results in ${path}.`);
  }
  return run;
}

export function printDayPlan(match: RegExp | null): void {
  const sessions = SESSIONS.filter((session) => !match || match.test(session.id));
  const totals = new Map<BaseArm, number>(DAY_ARMS.map((arm) => [arm, 0]));
  for (const session of sessions) {
    const costs = DAY_ARMS.map((arm) => {
      totals.set(arm, totals.get(arm)! + session.expectUsd[arm]);
      return `${arm} $${session.expectUsd[arm].toFixed(2)} (cap $${sessionCap(session, arm).toFixed(2)})`;
    });
    console.log(
      `${session.id} ${session.title} [${LEVELS[session.level].label}]: ${costs.join(', ')}`,
    );
  }
  const all = [...totals.values()].reduce((sum, value) => sum + value, 0);
  console.log(
    `Expected: ${DAY_ARMS.map((arm) => `${arm} $${totals.get(arm)!.toFixed(2)}`).join(', ')}; all arms $${all.toFixed(2)} (budget check projects ×${PROJECTION_FACTOR}: $${(all * PROJECTION_FACTOR).toFixed(2)}; hard cap $${DEV_DAY_HARD_CAP_USD}).`,
  );
}
