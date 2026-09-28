import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Browser } from '@playwright/test';
import { connectableIdSchema } from '../../../packages/contracts/src/index.ts';
import type { DiffStat } from '../../bench/verify.ts';
import { stopBench } from '../../bench/live.ts';
import { benchEnv } from '../bench-env.ts';
import type { BaseArm } from '../scenario-types.ts';
import { startStack, stopStack, type Runtime, type Stack } from '../stack.ts';
import { openBrowser } from '../ui-driver.ts';
import type { ArmDay, ArmSessionResult, PreparedTurn } from './arm.ts';
import { NO_HARNESS_EVIDENCE } from './arm.ts';
import { DirectClaudeDay, DirectCodexDay } from './direct-day.ts';
import { startGitHubStub, type GitHubStub } from './github-stub.ts';
import { HarnessDay } from './harness-day.ts';
import { hiddenCounts, suiteCounts } from './hidden.ts';
import { DIRECT_LEVEL_LABEL, LEVELS } from './levels.ts';
import { anchorFor, pickPassage, quotedMessage } from './quotes.ts';
import { renderDayReport } from './report-day.ts';
import {
  ROOT,
  applyPatch,
  changedFiles,
  createRepo,
  diffStat,
  fingerprint,
  git,
  remoteBranches,
  settle,
  snapshot,
  type DayRepo,
} from './repos.ts';
import {
  DEFAULT_RATES,
  scoreSession,
  type Evidence,
  type Intervention,
  type Rates,
  type SessionScore,
} from './score.ts';
import { SESSIONS, type DaySession, type RepoKey } from './sessions.ts';

export const DEV_DAY_HARD_CAP_USD = 25;

/** The dry run's GitHub token, once the app knows a 'github' connection (after Ship merges). */
function fakeGitHubSecret(): Record<string, string> {
  return connectableIdSchema.safeParse('github').success
    ? { github: 'dev-day-fake-github-token' }
    : {};
}
export const DAY_ARMS: readonly BaseArm[] = ['harness', 'direct-claude', 'direct-codex'];
/** A session may spend this multiple of its expected cost before the bench stops it. */
const CAP_FACTOR = 3;
const MIN_CAP_USD = 0.5;
const PROJECTION_FACTOR = 1.3;
const LIMIT = /rate.?limit|usage limit|too many requests|\b429\b|overloaded|quota/i;

export interface DayTurnRecord {
  prompt: string;
  runId: string;
  status: string;
  error: string | null;
  wallMs: number;
  costUsd: number;
  crew: string[];
  interrupted: boolean;
  reply: string;
}

export interface DayRecord {
  session: string;
  title: string;
  arm: BaseArm;
  level: string;
  startedAt: string;
  wallMs: number;
  costUsd: number;
  capUsd: number;
  overCap: boolean;
  turns: DayTurnRecord[];
  evidence: Evidence;
  score: SessionScore;
  diff: DiffStat;
  shots: string[];
  conversation: string | null;
}

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
}

interface ArmState {
  day: ArmDay;
  repos: Map<RepoKey, DayRepo>;
  replies: Map<string, { reply: string; messageId: string | null }>;
}

export function sessionCap(session: DaySession, arm: BaseArm): number {
  return Math.max(MIN_CAP_USD, session.expectUsd[arm] * CAP_FACTOR);
}

export function projectedRound(session: DaySession, arms: readonly BaseArm[]): number {
  return arms.reduce((sum, arm) => sum + session.expectUsd[arm] * PROJECTION_FACTOR, 0);
}

function prepareTurns(
  session: DaySession,
  arm: BaseArm,
  state: ArmState,
  runtime: Runtime,
): { turns: PreparedTurn[]; interventions: Intervention[] } {
  const interventions: Intervention[] = [];
  const turns = session.turns.map((turn, index): PreparedTurn => {
    let text = turn.text;
    let quote: PreparedTurn['quote'] = null;
    if (turn.quote) {
      const source = state.replies.get(turn.quote.fromSession);
      const reply = source?.reply ?? '';
      const passage = pickPassage(reply, turn.quote.pick);
      quote = { passage, messageId: source?.messageId ?? null, anchor: anchorFor(reply, passage) };
      text = quotedMessage(passage, turn.text);
    }
    if (index === 0 && arm !== 'harness' && session.pastePlanFrom) {
      const plan = state.replies.get(session.pastePlanFrom)?.reply ?? '';
      text = `${text}\n\nHere is the plan we agreed on:\n\n${plan}`;
      interventions.push({ kind: 'paste', text: `pasted the plan from ${session.pastePlanFrom}` });
    }
    if (runtime === 'fake') text = `${text}${turn.fakeTags}`;
    const interrupt = turn.interruptAfterMs
      ? runtime === 'fake'
        ? turn.interruptAfterMs.fake
        : turn.interruptAfterMs.live
      : null;
    return { text, quote, interruptAfterMs: interrupt };
  });
  return { turns, interventions };
}

function failed(error: string): ArmSessionResult {
  return {
    ...NO_HARNESS_EVIDENCE,
    logs: [],
    reply: '',
    replyMessageId: null,
    reviewText: '',
    timedOut: false,
    error,
    cappedAtUsd: null,
    interventions: [],
    conversation: null,
  };
}

function shipEvidence(
  session: DaySession,
  repo: DayRepo,
  stub: GitHubStub,
  pullsBefore: number,
): Pick<Evidence, 'draftPr' | 'pushedBranches'> {
  if (!session.ship || !repo.remote) return { draftPr: null, pushedBranches: [] };
  const branches = remoteBranches(repo.remote).filter((branch) => branch !== 'main');
  const pull = stub.pulls.slice(pullsBefore).at(-1);
  return {
    draftPr: pull
      ? { opened: true, draft: pull.draft, branchPushed: branches.includes(pull.head) }
      : { opened: false, draft: false, branchPushed: false },
    pushedBranches: branches,
  };
}

function directShipInterventions(evidence: Pick<Evidence, 'pushedBranches'>): Intervention[] {
  const list: Intervention[] = [];
  if (evidence.pushedBranches.length === 0) {
    list.push({ kind: 'manual-push', text: 'pushed the branch by hand' });
  }
  list.push({ kind: 'manual-pr', text: 'opened the draft PR by hand' });
  return list;
}

const clip = (text: string, length: number) =>
  text.length > length ? `${text.slice(0, length)}…` : text;

async function runSession(
  options: DayOptions,
  session: DaySession,
  state: ArmState,
  stub: GitHubStub,
): Promise<DayRecord> {
  const arm = state.day.arm;
  let repo = state.repos.get(session.repo);
  if (!repo) {
    repo = await createRepo(session.repo, options.dir, `${arm}-${session.repo}`);
    state.repos.set(session.repo, repo);
  }
  const base = git(repo.path, 'rev-parse', 'HEAD').trim();
  if (session.plantBefore) await applyPatch(repo.path, session.plantBefore);
  const before = snapshot(repo.path);
  const prepared = prepareTurns(session, arm, state, options.runtime);
  const capUsd = sessionCap(session, arm);
  const pullsBefore = stub.pulls.length;
  const startedAt = new Date().toISOString();
  const result = await state.day
    .run(session, repo, prepared.turns, capUsd)
    .catch((error: unknown) => failed(error instanceof Error ? error.message : String(error)));
  const changed = changedFiles(repo.path, before);
  const scratch = join(options.dir, 'scratch');
  const hidden = session.expect.hidden
    ? await hiddenCounts(session.repo, repo.path, session.expect.hidden, scratch)
    : null;
  const suite = session.expect.hidden ? await suiteCounts(session.repo, repo.path, scratch) : null;
  const ship = shipEvidence(session, repo, stub, pullsBefore);
  const interventions = [
    ...prepared.interventions,
    ...result.interventions,
    ...(session.ship && arm !== 'harness' ? directShipInterventions(ship) : []),
  ];
  const evidence: Evidence = {
    arm,
    changed,
    reply: result.reply,
    reviewText: result.reviewText,
    clarifyCard: result.clarifyCard,
    planCard: result.planCard,
    planSaved: result.planSaved,
    hidden,
    suite,
    timedOut: result.timedOut,
    error: result.error,
    originalUntouched: repo.original
      ? fingerprint(repo.original.path) === repo.original.fingerprint
      : null,
    roles: result.roles,
    checksRan: result.checksRan,
    builderPlanLoaded: result.builderPlanLoaded,
    criticPlanLoaded: result.criticPlanLoaded,
    topTier: result.topTier,
    worktrees: result.worktrees,
    cardFirst: result.cardFirst,
    builders: result.builders,
    parallelBuilders: result.parallelBuilders,
    handoff: result.handoff,
    resumed: result.resumed,
    shipAvailable: result.shipAvailable,
    interventions,
    clicks: result.clicks,
    ...ship,
  };
  const score = scoreSession(session, evidence, options.rates);
  const diff = diffStat(repo.path, base);
  await settle(repo, options.dir, base, session.reference, `Developer: ${session.id} done`);
  state.replies.set(session.id, { reply: result.reply, messageId: result.replyMessageId });
  const costUsd = result.logs.reduce((sum, log) => sum + log.metrics.costUsd, 0);
  return {
    session: session.id,
    title: session.title,
    arm,
    level: arm === 'harness' ? LEVELS[session.level].label : DIRECT_LEVEL_LABEL,
    startedAt,
    wallMs: result.logs.reduce((sum, log) => sum + log.metrics.wallMs, 0),
    costUsd,
    capUsd,
    overCap: result.cappedAtUsd !== null || costUsd > capUsd,
    turns: result.logs.map((log) => ({
      prompt: clip(log.prompt, 600),
      runId: log.metrics.runId,
      status: log.metrics.status,
      error: log.metrics.error,
      wallMs: log.metrics.wallMs,
      costUsd: log.metrics.costUsd,
      crew: log.metrics.agents.map(
        (agent) => `${agent.role} ${agent.model ?? '?'}·${agent.effort ?? '?'}`,
      ),
      interrupted: log.interrupted,
      reply: clip(log.metrics.reply, 3_000),
    })),
    evidence: {
      ...evidence,
      reply: clip(evidence.reply, 3_000),
      reviewText: clip(evidence.reviewText, 4_000),
    },
    score,
    diff,
    shots: result.shots,
    conversation: result.conversation,
  };
}

async function save(options: DayOptions, run: DayRun): Promise<string> {
  const path = join(options.dir, `dev-day-${options.label}.json`);
  await writeFile(path, `${JSON.stringify(run, null, 2)}\n`);
  await writeFile(path.replace(/\.json$/, '.md'), renderDayReport(run));
  return path;
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
    setup: {},
    records: [],
  };
}

function rateLimited(record: DayRecord): boolean {
  return [record.evidence.error, ...record.turns.map((turn) => turn.error)].some(
    (text) => text !== null && LIMIT.test(text),
  );
}

async function armDays(
  options: DayOptions,
  stub: GitHubStub,
  cleanups: (() => Promise<void>)[],
): Promise<Map<BaseArm, ArmState>> {
  const states = new Map<BaseArm, ArmState>();
  const fresh = (day: ArmDay): ArmState => ({ day, repos: new Map(), replies: new Map() });
  if (options.arms.includes('harness')) {
    const maxCap = Math.max(...SESSIONS.map((session) => sessionCap(session, 'harness')));
    process.env.E2E_RUN_CAP_USD ??= String(maxCap);
    const ghHome = join(options.dir, 'gh-empty');
    await mkdir(ghHome, { recursive: true });
    const stack: Stack = await startStack(
      options.runtime,
      'current',
      ROOT,
      options.dir,
      options.shots,
      {
        env: { GITHUB_API_URL: stub.url, GH_CONFIG_DIR: ghHome, GIT_TERMINAL_PROMPT: '0' },
        unset: ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN'],
        secrets: fakeGitHubSecret(),
      },
    );
    cleanups.push(() => stopStack(stack, options.keepData));
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
    const states = await armDays(options, stub, cleanups);
    const sessions = SESSIONS.filter((session) => !options.match || options.match.test(session.id));
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
    for (const cleanup of cleanups.reverse()) await cleanup().catch(() => undefined);
    const path = await save(options, run);
    console.log(`Spent $${run.spentUsd.toFixed(3)}. Results in ${path}.`);
  }
  return run;
}

export const DEFAULT_DAY_RATES = DEFAULT_RATES;

/** The session list with expected spend and caps per arm, for `--plan`. */
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
