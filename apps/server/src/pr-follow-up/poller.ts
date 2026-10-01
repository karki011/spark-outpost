import { advisorEntry } from '../providers/catalog.ts';
import { getApproval } from '../persistence/approvals.ts';
import type { Queryable } from '../persistence/db.ts';
import { prFollowUpSettings, type PrFollowUpSettings } from '../persistence/pr-settings.ts';
import {
  dueWatches,
  feedbackFor,
  insertFeedback,
  knownSourceKeys,
  saveWatch,
  updateFeedback,
  WATCHING_LINE,
  type Watch,
} from '../persistence/pr-watches.ts';
import type { JevAccess } from '../orchestration/jev-calls.ts';
import type { GitHubConnection } from '../ship/github/connection.ts';
import { connectTo, nowOf, type FollowUpDeps } from './deps.ts';
import { readChecks, readComments, readPullFacts } from './gather.ts';
import { afterDecision, finishRound, startRound } from './round.ts';
import {
  BUSY_INTERVAL_SECONDS,
  LIMIT_LINE,
  MAX_INTERVAL_SECONDS,
  nextInterval,
  newSourceKeys,
  roundDecision,
  stateFor,
} from './rounds.ts';
import { triageFeedback } from './triage.ts';
import { isTrusted, writersAmong } from './trust.ts';

const TICK_MS = 15_000;
const MAX_ERROR_CHARS = 300;

async function jevAccess(
  deps: FollowUpDeps,
  db: Queryable,
  workspaceId: string,
): Promise<JevAccess | null> {
  if (!deps.jev) return null;
  const { rows } = await db.query<{ model: string | null }>(
    `SELECT model FROM advisor_connections
     WHERE workspace_id = $1 AND advisor = 'jev' AND disconnected_at IS NULL LIMIT 1`,
    [workspaceId],
  );
  if (!rows[0]) return null;
  return { deps: deps.jev, model: rows[0].model ?? advisorEntry('jev').defaultModel };
}

async function ingest(
  deps: FollowUpDeps,
  watch: Watch,
  connection: GitHubConnection,
  settings: PrFollowUpSettings,
): Promise<number> {
  const repo = { owner: watch.owner, name: watch.repo };
  const checks = await readChecks(connection, repo, watch.headSha!);
  watch.checks = checks.state;
  const comments = await readComments(connection, repo, watch.number);
  const fresh = newSourceKeys(
    [...checks.failing, ...comments],
    await knownSourceKeys(deps.db, watch.id),
  );
  if (fresh.length === 0) return 0;
  const writers = await writersAmong(
    connection,
    repo,
    fresh.filter((item) => item.kind !== 'check').map((item) => item.author),
  );
  const signal = deps.signal ?? new AbortController().signal;
  const readings = await triageFeedback(
    await jevAccess(deps, deps.db, watch.workspaceId),
    { repo: `${watch.owner}/${watch.repo}`, number: watch.number },
    fresh,
    signal,
  );
  const triaged = fresh.map((item, index) => {
    const trusted = isTrusted(item, writers);
    const { triage, by } = readings[index]!;
    return {
      ...item,
      trusted,
      triage,
      triagedBy: by,
      state: stateFor({ kind: item.kind, trusted }, triage, settings),
    };
  });
  return (await insertFeedback(deps.db, watch.id, triaged)).length;
}

function idleLine(waiting: number): string {
  if (waiting === 0) return WATCHING_LINE;
  const items = `${waiting} ${waiting === 1 ? 'item needs' : 'items need'} you`;
  return `${items}. ${WATCHING_LINE}`;
}

async function decideNext(deps: FollowUpDeps, watch: Watch): Promise<Watch> {
  const queued = await feedbackFor(deps.db, watch.id, ['queued']);
  const decision = roundDecision(watch.rounds, queued.length, watch.requested);
  if (decision === 'start') return startRound(deps, watch, queued);
  if (decision === 'limit') {
    await updateFeedback(
      deps.db,
      queued.map((item) => item.id),
      { state: 'needs_user' },
    );
    return { ...watch, phase: 'needs_you', doing: LIMIT_LINE, requested: false };
  }
  const waiting = (await feedbackFor(deps.db, watch.id, ['needs_user'])).length;
  return {
    ...watch,
    phase: waiting > 0 ? 'needs_you' : 'watching',
    doing: idleLine(waiting),
    requested: false,
  };
}

function ended(watch: Watch, state: 'merged' | 'closed'): Watch {
  return {
    ...watch,
    prState: state,
    phase: 'done',
    doing: `The PR was ${state}. Spark stopped watching it.`,
  };
}

async function observe(deps: FollowUpDeps, watch: Watch): Promise<Watch> {
  const connection = await connectTo(deps, watch);
  if (!connection) throw new Error(`GitHub is not connected for ${watch.host}.`);
  const facts = await readPullFacts(
    connection,
    { owner: watch.owner, name: watch.repo },
    watch.number,
  );
  const seen: Watch = { ...watch, draft: facts.draft, headSha: facts.headSha };
  if (facts.state !== 'open') return ended(seen, facts.state);
  if (watch.phase === 'fixing' || watch.phase === 'confirming') return seen;
  const settings = await prFollowUpSettings(deps.db, watch.workspaceId);
  const added = await ingest(deps, seen, connection, settings);
  const next = await decideNext(deps, seen);
  return { ...next, intervalSeconds: nextInterval(watch.intervalSeconds, added > 0) };
}

async function advance(deps: FollowUpDeps, watch: Watch): Promise<Watch> {
  if (watch.phase === 'fixing') return finishRound(deps, watch);
  if (watch.phase === 'confirming' && watch.approvalId) {
    const approval = await getApproval(deps.db, watch.approvalId);
    if (!approval) return { ...watch, phase: 'watching', approvalId: null };
    return afterDecision(deps, watch, approval);
  }
  return observe(deps, watch);
}

function busy(watch: Watch): boolean {
  return watch.phase === 'fixing' || watch.phase === 'confirming';
}

function schedule(deps: FollowUpDeps, watch: Watch): Watch {
  const now = nowOf(deps);
  const seconds = busy(watch) ? BUSY_INTERVAL_SECONDS : watch.intervalSeconds;
  return { ...watch, lastPolledAt: now, nextPollAt: new Date(now.getTime() + seconds * 1000) };
}

export async function pollWatch(deps: FollowUpDeps, watch: Watch): Promise<Watch> {
  const settings = await prFollowUpSettings(deps.db, watch.workspaceId);
  let next: Watch;
  if (!settings.enabled && !busy(watch)) {
    next = {
      ...watch,
      doing: 'PR follow-up is off in Settings.',
      intervalSeconds: MAX_INTERVAL_SECONDS,
    };
  } else {
    try {
      next = { ...(await advance(deps, watch)), lastError: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      next = {
        ...watch,
        lastError: message.slice(0, MAX_ERROR_CHARS),
        intervalSeconds: nextInterval(watch.intervalSeconds, false),
      };
    }
  }
  const saved = schedule(deps, next);
  await saveWatch(deps.db, saved);
  return saved;
}

export async function pollDue(deps: FollowUpDeps): Promise<number> {
  const watches = await dueWatches(deps.db, nowOf(deps));
  for (const watch of watches) await pollWatch(deps, watch);
  return watches.length;
}

export interface PrFollowUp {
  wake(): void;
  stop(): Promise<void>;
}

export function startPrFollowUp(deps: FollowUpDeps, tickMs = TICK_MS): PrFollowUp {
  let stopped = false;
  let wakeUp: (() => void) | null = null;
  const sleep = () =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, tickMs);
      wakeUp = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  const loop = (async () => {
    while (!stopped) {
      await pollDue(deps).catch((error: unknown) => {
        console.error('PR follow-up poll failed', error);
      });
      if (!stopped) await sleep();
    }
  })();
  return {
    wake: () => wakeUp?.(),
    async stop() {
      stopped = true;
      wakeUp?.();
      await loop;
    },
  };
}
