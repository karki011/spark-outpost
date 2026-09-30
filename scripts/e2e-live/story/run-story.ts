import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startBench, stopBench } from '../../bench/live.ts';
import { outOfScope } from '../../bench/verify.ts';
import { benchEnv } from '../bench-env.ts';
import { hitRateLimit } from '../results.ts';
import { setConnections } from '../seed.ts';
import { ROOT, startStack, stopStack, type Runtime, type Stack } from '../stack.ts';
import type { ArmDay, ArmSessionResult } from '../dev-day/arm.ts';
import { DirectClaudeDay } from '../dev-day/direct-day.ts';
import { FAKE_GITHUB_TOKEN, type GitHubStub } from '../dev-day/github-stub.ts';
import { HarnessDay } from '../dev-day/harness-day.ts';
import { existsSync } from 'node:fs';
import { loadavg } from 'node:os';
import { changedFiles, snapshot, type Snapshot } from '../dev-day/repos.ts';
import { connectFakeGitHub, GITHUB_TOKEN_ENV, stackSecrets } from '../dev-day/run-day.ts';
import { scoreSession, type Evidence, type Rates } from '../dev-day/score.ts';
import { failed, shipEvidence } from '../dev-day/session-run.ts';
import { stackEnv, type StoryArm } from './arms.ts';
import { storyMetrics } from './metrics.ts';
import { startRateLimitProxy, type RateLimitProxy } from './proxy.ts';
import type { StoryAgent, StoryRecord, StoryRun } from './record.ts';
import { renderStoryReport } from './report-story.ts';
import { developerMinutes, storyPassed } from './summary.ts';
import { createStoryRepo, storyHidden, storySuite } from './repo.ts';
import { storySession, STORY_ALLOWED } from './story.ts';

export const STORY_HARD_CAP_USD = 40;
const RUN_CAP_USD = 5;
const SERVER_CAP_USD = '4.5';
const PROJECTION_FACTOR = 1.3;
const PR_TABLE = /\|\s*Piece\s*\|\s*Builder\s*\||Pieces \(\d+/;

export interface StoryOptions {
  runtime: Runtime;
  dir: string;
  label: string;
  budgetUsd: number;
  timeoutMs: number;
  arms: readonly StoryArm[];
  repeats: number;
  pr: 'no' | 'also' | 'only';
  rates: Rates;
  keepData: boolean;
  stub: GitHubStub;
}

interface ArmContext {
  day: ArmDay;
  stack: Stack | null;
  proxy: RateLimitProxy | null;
  close(): Promise<void>;
}

async function openHarness(options: StoryOptions, arm: StoryArm, run: StoryRun) {
  const proxy =
    arm.codexRateLimited && options.runtime === 'acp'
      ? await startRateLimitProxy(options.dir, 1)
      : null;
  const ghHome = join(options.dir, `gh-empty-${arm.key}`);
  await mkdir(ghHome, { recursive: true });
  process.env.E2E_RUN_CAP_USD = SERVER_CAP_USD;
  const secrets = await stackSecrets(options.runtime);
  const stack = await startStack(options.runtime, 'current', ROOT, options.dir, false, {
    env: {
      ...stackEnv(arm),
      ...proxy?.env,
      GITHUB_API_URL: options.stub.url,
      GH_CONFIG_DIR: ghHome,
      GIT_TERMINAL_PROMPT: '0',
      SECRET_STORE: 'memory',
      MEMORY_SECRETS: JSON.stringify(secrets),
    },
    unset: GITHUB_TOKEN_ENV,
    secrets: { github: FAKE_GITHUB_TOKEN },
  });
  await setConnections(stack.db, stack.workspaceId, { jev: true, codex: arm.codex, zai: false });
  await connectFakeGitHub(stack, ghHome, run);
  const day = new HarnessDay(stack, {
    timeoutMs: options.timeoutMs,
    shotsDir: null,
    browser: null,
  });
  return {
    day,
    stack,
    proxy,
    close: async () => {
      await stopStack(stack, options.keepData);
      await proxy?.close();
    },
  };
}

async function openArm(options: StoryOptions, arm: StoryArm, run: StoryRun): Promise<ArmContext> {
  if (arm.kind === 'harness') return openHarness(options, arm, run);
  const env =
    options.runtime === 'acp' ? await startBench(RUN_CAP_USD, 'acp') : await benchEnv('fake');
  return {
    day: new DirectClaudeDay(env, options.timeoutMs),
    stack: null,
    proxy: null,
    close: () => stopBench(env),
  };
}

function agentsOf(result: ArmSessionResult): StoryAgent[] {
  return result.logs.flatMap((log) =>
    log.metrics.agents.map((agent) => ({
      role: agent.role,
      name: agent.name,
      provider: agent.provider,
      model: agent.model,
      costUsd: agent.costUsd,
      status: agent.status,
    })),
  );
}

function costByProvider(result: ArmSessionResult): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const log of result.logs) {
    for (const agent of log.metrics.agents)
      totals[agent.provider] = (totals[agent.provider] ?? 0) + agent.costUsd;
    if (log.metrics.jevCostUsd > 0) totals.jev = (totals.jev ?? 0) + log.metrics.jevCostUsd;
  }
  return totals;
}

const PASSING_CHECK = /\b(?:passed|pass|green|ok)\b/i;
const FAILING_CHECK = /\bfail/i;
const APPROVING_VERDICT = /good|pass|approve|clean|unclear/i;

export function criticBeyond(fullChecks: string[], critic: StoryRecord['critic']): boolean | null {
  if (critic.length === 0) return null;
  const green =
    fullChecks.length > 0 &&
    PASSING_CHECK.test(fullChecks.at(-1)!) &&
    !FAILING_CHECK.test(fullChecks.at(-1)!);
  return green && critic.some((review) => !APPROVING_VERDICT.test(review.verdict));
}

function evidenceOf(
  arm: StoryArm,
  result: ArmSessionResult,
  changed: string[],
  tests: Pick<Evidence, 'hidden' | 'suite'>,
  ship: Pick<Evidence, 'draftPr' | 'pushedBranches'>,
): Evidence {
  return {
    ...result,
    arm: arm.kind,
    changed,
    ...tests,
    originalUntouched: null,
    ...ship,
  };
}

async function workTree(
  ctx: ArmContext,
  conversation: string | null,
  repo: string,
  before: Snapshot,
): Promise<{ path: string; before: Snapshot }> {
  if (!ctx.stack || !conversation) return { path: repo, before };
  const { rows } = await ctx.stack.db.query<{ path: string; base_commit: string }>(
    `SELECT path, base_commit FROM chat_worktrees WHERE conversation_id = $1
     ORDER BY created_at DESC LIMIT 1`,
    [conversation],
  );
  const chat = rows[0];
  if (!chat || !existsSync(chat.path)) return { path: repo, before };
  return { path: chat.path, before: { head: chat.base_commit, branch: '', files: new Map() } };
}

async function runOnce(
  options: StoryOptions,
  ctx: ArmContext,
  arm: StoryArm,
  rep: number,
  ship: boolean,
): Promise<StoryRecord> {
  const name = `${arm.key}-${rep}${ship ? '-pr' : ''}-${Date.now()}`;
  const repo = await createStoryRepo(options.dir, name);
  const session = {
    ...storySession(ship ? 'fullAuto' : 'autoEdit', arm.fakeTags, ship),
    thread: name,
  };
  const text = `${session.turns[0]!.text}${options.runtime === 'fake' ? arm.fakeTags : ''}`;
  const before = snapshot(repo.path);
  const pullsBefore = options.stub.pulls.length;
  const proxyBefore = ctx.proxy?.lines.length ?? 0;
  const startedAt = new Date().toISOString();
  const loadBefore = loadavg()[0]!;
  const result = await ctx.day
    .run(session, repo, [{ text, quote: null, interruptAfterMs: null }], RUN_CAP_USD)
    .catch((error: unknown) => failed(error instanceof Error ? error.message : String(error)));
  const work = await workTree(ctx, result.conversation, repo.path, before);
  const changed = changedFiles(work.path, work.before);
  const hidden = await storyHidden(work.path);
  const suite = await storySuite(work.path);
  const shipped = shipEvidence(session, repo, options.stub, pullsBefore);
  const evidence = evidenceOf(
    arm,
    result,
    changed,
    { hidden: hidden.counts, suite: suite.counts },
    shipped,
  );
  const score = scoreSession(session, evidence, options.rates);
  const runIds = result.logs.map((log) => log.metrics.runId);
  const fullChecks = result.logs.flatMap((log) => log.metrics.checks);
  const critic = result.logs.flatMap((log) =>
    log.metrics.reviews.map((review) => ({ verdict: review.verdict, findings: review.findings })),
  );
  const pull = options.stub.pulls.slice(pullsBefore).at(-1);
  const failedChecks = score.checks
    .filter((check) => check.ok === false)
    .map((check) => `${check.id}: ${check.detail}`);
  return {
    arm: arm.key,
    rep,
    level: session.level,
    ship,
    startedAt,
    workPath: work.path,
    load: [Math.round(loadBefore), Math.round(loadavg()[0]!)],
    wallMs: result.logs.reduce((sum, log) => sum + log.metrics.wallMs, 0),
    costUsd: result.logs.reduce((sum, log) => sum + log.metrics.costUsd, 0),
    costByProvider: costByProvider(result),
    capUsd: RUN_CAP_USD,
    cappedAtUsd: result.cappedAtUsd,
    passed: storyPassed(failedChecks),
    failedChecks,
    hidden: hidden.counts,
    hiddenFailing: hidden.failing,
    suite: suite.counts,
    changed,
    outside: outOfScope(changed, STORY_ALLOWED),
    interventions: result.interventions.map((item) => `${item.kind}: ${item.text}`),
    clicks: result.clicks,
    userMinutes: developerMinutes(
      { passed: storyPassed(failedChecks), interventions: result.interventions },
      options.rates,
    ),
    error: result.error,
    timedOut: result.timedOut,
    runIds,
    agents: agentsOf(result),
    fullChecks,
    critic,
    criticBeyondChecks: criticBeyond(fullChecks, critic),
    metrics: ctx.stack ? await storyMetrics(ctx.stack.db, runIds, result.reply) : null,
    pr: ship
      ? {
          opened: Boolean(pull),
          draft: pull?.draft ?? false,
          pieceTable: PR_TABLE.test(pull?.body ?? ''),
          body: (pull?.body ?? '').slice(0, 6_000),
        }
      : null,
    proxy: ctx.proxy ? ctx.proxy.lines.slice(proxyBefore) : null,
    reply: result.reply.slice(0, 4_000),
  };
}

async function save(options: StoryOptions, run: StoryRun): Promise<string> {
  const path = join(options.dir, `story-${options.label}.json`);
  await writeFile(path, `${JSON.stringify(run, null, 2)}\n`);
  await writeFile(path.replace(/\.json$/, '.md'), renderStoryReport(run));
  return path;
}

function plannedRuns(options: StoryOptions, arm: StoryArm): boolean[] {
  const plain = options.pr === 'only' ? [] : Array.from({ length: options.repeats }, () => false);
  const withPr = options.pr !== 'no' && arm.kind === 'harness' ? [true] : [];
  return [...plain, ...withPr];
}

function unexpectedLimit(arm: StoryArm, record: StoryRecord): boolean {
  if (arm.codexRateLimited) return false;
  return hitRateLimit([record.error, ...record.agents.map((agent) => agent.status)]);
}

export async function runStory(options: StoryOptions): Promise<StoryRun> {
  if (options.budgetUsd > STORY_HARD_CAP_USD) {
    throw new Error(`The story benchmark is capped at $${STORY_HARD_CAP_USD}.`);
  }
  const run: StoryRun = {
    version: 1,
    kind: 'story',
    date: new Date().toISOString().slice(0, 10),
    runtime: options.runtime,
    budgetUsd: options.budgetUsd,
    spentUsd: 0,
    stopped: null,
    rates: options.rates,
    arms: options.arms.map((arm) => arm.key),
    repeats: options.repeats,
    setup: {},
    records: [],
  };
  outer: for (const arm of options.arms) {
    const planned = plannedRuns(options, arm);
    if (planned.length === 0) continue;
    const ctx = await openArm(options, arm, run);
    try {
      for (const [index, ship] of planned.entries()) {
        const projected = arm.expectUsd * PROJECTION_FACTOR;
        if (options.runtime === 'acp' && run.spentUsd + projected > options.budgetUsd) {
          run.stopped = `Stopped before ${arm.key} run ${index + 1}: spent $${run.spentUsd.toFixed(2)}, the next run could cost $${projected.toFixed(2)} (budget $${options.budgetUsd}).`;
          console.log(run.stopped);
          break outer;
        }
        console.log(`Running story on ${arm.label}${ship ? ' (Full auto → PR)' : ''}…`);
        const record = await runOnce(options, ctx, arm, index + 1, ship);
        run.records.push(record);
        run.spentUsd += record.costUsd;
        console.log(
          `  ${record.passed ? 'PASS' : 'FAIL'} hidden ${record.hidden?.pass ?? '?'}/${record.hidden?.tests ?? '?'} ${(record.wallMs / 1000).toFixed(0)} s $${record.costUsd.toFixed(3)} spent=$${run.spentUsd.toFixed(2)} ${record.failedChecks.join('; ').slice(0, 300)}`,
        );
        await save(options, run);
        if (unexpectedLimit(arm, record)) {
          run.stopped = `Paused after ${arm.key}: an agent hit a rate or usage limit.`;
          console.log(run.stopped);
          break outer;
        }
      }
    } finally {
      await ctx.close().catch(() => undefined);
    }
  }
  run.setup['github stub requests'] = String(options.stub.requests.length);
  run.setup['github stub foreign credentials'] =
    options.stub.foreignCredentials.length === 0
      ? 'none'
      : options.stub.foreignCredentials.join('; ');
  const path = await save(options, run);
  console.log(`Spent $${run.spentUsd.toFixed(3)}. Results in ${path}.`);
  return run;
}
