import { advisorEntry } from '../providers/catalog.ts';
import { getApproval } from '../persistence/approvals.ts';
import type { Queryable } from '../persistence/db.ts';
import { prFollowUpSettings, type PrFollowUpSettings } from '../persistence/pr-settings.ts';
import { sparkPaused } from '../persistence/spark-pause.ts';
import {
  feedbackFor,
  insertFeedback,
  isWatch,
  knownSourceKeys,
  updateFeedback,
  WATCHING_LINE,
  type Watch,
} from '../persistence/pr-watches.ts';
import { deferPulls, duePulls, savePull, type TrackedPull } from '../persistence/tracked-pulls.ts';
import {
  accessReason,
  endedPull,
  isRateLimited,
  pollProblemOf,
  readFacts,
  reopenedPull,
  statusChanged,
  trackOpenPull,
  withFacts,
} from '../pr-tracking/status.ts';
import { discussionDetails } from '../pr-tracking/details.ts';
import type { JevAccess } from '../advisor/jev-calls.ts';
import type { GitHubConnection } from '../ship/github/connection.ts';
import { connectTo, nowOf, type FollowUpDeps } from './deps.ts';
import { readChecks, readComments } from './gather.ts';
import { afterDecision, finishRound, startRound } from './round.ts';
import {
  BUSY_INTERVAL_SECONDS,
  LIMIT_LINE,
  MAX_INTERVAL_SECONDS,
  nextInterval,
  newSourceKeys,
  PAUSED_LINE,
  roundDecision,
  stateFor,
} from './rounds.ts';
import { triageFeedback } from './triage.ts';
import { isTrusted, writersAmong } from './trust.ts';

const TICK_MS = 15_000;
const MAX_ERROR_CHARS = 300;
const FOLLOW_UP_OFF_LINE = 'PR follow-up is off in Settings.';
const RATE_LIMIT_LINE = 'GitHub’s rate limit is used up.';

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
  watch.failingChecks = checks.failingChecks;
  const comments = await readComments(connection, repo, watch.number);
  watch.review = comments.review;
  watch.details = {
    checkRuns: checks.checkRuns,
    ...(await discussionDetails(connection, repo, watch.number, comments.discussion)),
  };
  const fresh = newSourceKeys(
    [...checks.failing, ...comments.gathered],
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
  if (decision === 'start' && (await sparkPaused(deps.db, watch.workspaceId))) {
    return { ...watch, phase: 'watching', doing: PAUSED_LINE };
  }
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

const pending = (pull: TrackedPull) => pull.checks === 'pending';

async function follow(
  deps: FollowUpDeps,
  watch: Watch,
  seen: Watch,
  connection: GitHubConnection,
  settings: PrFollowUpSettings,
): Promise<TrackedPull> {
  const added = await ingest(deps, seen, connection, settings);
  const next = await decideNext(deps, seen);
  return {
    ...next,
    intervalSeconds: nextInterval(watch.intervalSeconds, added > 0 || pending(next)),
  };
}

async function observe(
  deps: FollowUpDeps,
  pull: TrackedPull,
  settings: PrFollowUpSettings,
): Promise<TrackedPull> {
  const { connection, facts } = await readFacts(await connectTo(deps, pull), pull);
  const read = withFacts(pull, facts);
  if (facts.state !== 'open') {
    return { ...endedPull(read, facts.state), intervalSeconds: MAX_INTERVAL_SECONDS };
  }
  const seen = reopenedPull(read);
  if (busy(pull)) return seen;
  if (settings.enabled && isWatch(seen) && isWatch(pull)) {
    return follow(deps, pull, seen, connection, settings);
  }
  const tracked = await trackOpenPull(connection, seen);
  const next = isWatch(seen) ? { ...tracked, doing: FOLLOW_UP_OFF_LINE } : tracked;
  return {
    ...next,
    intervalSeconds: nextInterval(pull.intervalSeconds, statusChanged(pull, next) || pending(next)),
  };
}

async function advance(
  deps: FollowUpDeps,
  pull: TrackedPull,
  settings: PrFollowUpSettings,
): Promise<TrackedPull> {
  if (isWatch(pull) && pull.phase === 'fixing') return finishRound(deps, pull);
  if (isWatch(pull) && pull.phase === 'confirming' && pull.approvalId) {
    const approval = await getApproval(deps.db, pull.approvalId);
    if (!approval) return { ...pull, phase: 'watching', approvalId: null };
    return afterDecision(deps, pull, approval);
  }
  return observe(deps, pull, settings);
}

function busy(pull: TrackedPull): boolean {
  return pull.phase === 'fixing' || pull.phase === 'confirming';
}

function schedule(deps: FollowUpDeps, pull: TrackedPull): TrackedPull {
  const now = nowOf(deps);
  const seconds = busy(pull) ? BUSY_INTERVAL_SECONDS : pull.intervalSeconds;
  return { ...pull, lastPolledAt: now, nextPollAt: new Date(now.getTime() + seconds * 1000) };
}

function failed(pull: TrackedPull, error: unknown): TrackedPull {
  const message = error instanceof Error ? error.message : String(error);
  const reason = accessReason(pull, error);
  return {
    ...pull,
    lastError: message.slice(0, MAX_ERROR_CHARS),
    pollProblem: pollProblemOf(error),
    statusReason: reason ?? pull.statusReason,
    intervalSeconds: reason ? MAX_INTERVAL_SECONDS : nextInterval(pull.intervalSeconds, false),
  };
}

export interface Polled {
  pull: TrackedPull;
  rateLimited: boolean;
}

async function poll(deps: FollowUpDeps, pull: TrackedPull): Promise<Polled> {
  const settings = await prFollowUpSettings(deps.db, pull.workspaceId);
  let next: TrackedPull;
  let rateLimited = false;
  try {
    next = { ...(await advance(deps, pull, settings)), lastError: null, pollProblem: null };
  } catch (error) {
    rateLimited = isRateLimited(error);
    next = failed(pull, error);
  }
  const saved = { ...schedule(deps, next), refreshRequested: false };
  await savePull(deps.db, saved);
  return { pull: saved, rateLimited };
}

export async function pollWatch(deps: FollowUpDeps, pull: TrackedPull): Promise<TrackedPull> {
  return (await poll(deps, pull)).pull;
}

async function pauseHost(deps: FollowUpDeps, limited: TrackedPull): Promise<void> {
  const until = new Date(nowOf(deps).getTime() + MAX_INTERVAL_SECONDS * 1000);
  await deferPulls(
    deps.db,
    limited.workspaceId,
    limited.host,
    until,
    limited.lastError ?? RATE_LIMIT_LINE,
  );
}

export async function pollDue(deps: FollowUpDeps): Promise<number> {
  const pulls = await duePulls(deps.db, nowOf(deps));
  const paused = new Set<string>();
  let polled = 0;
  for (const pull of pulls) {
    const key = `${pull.workspaceId} ${pull.host}`;
    if (paused.has(key)) continue;
    const result = await poll(deps, pull);
    polled += 1;
    if (!result.rateLimited) continue;
    paused.add(key);
    await pauseHost(deps, result.pull);
  }
  return polled;
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
