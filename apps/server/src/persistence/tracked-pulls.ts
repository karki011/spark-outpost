import {
  prTicketSyncSchema,
  type PrChecks,
  type PrFailingCheck,
  type PrOpenedVia,
  type PrPollProblem,
  type PrReview,
  type PrTicketSync,
  type PrWatchPhase,
  type RoundOutcome,
} from '@spark-outpost/contracts';
import { parseDetails, type StoredDetails } from '../pr-tracking/details.ts';
import type { Queryable } from './db.ts';
import { newId } from './ids.ts';
import { roundOutcomesOf } from './relay.ts';

export const WATCHING_LINE = 'Watching checks and reviews.';
export const TRACKING_LINE = 'Tracking checks and reviews.';

export interface PullAddress {
  host: string;
  owner: string;
  repo: string;
  number: number;
}

export interface TrackTarget extends PullAddress {
  workspaceId: string;
  conversationId: string;
  taskId: string | null;
  url: string;
  branch: string;
  draft?: boolean | undefined;
  via: PrOpenedVia;
  by: string | null;
  runId: string | null;
  outside: boolean;
  followUp: boolean;
  title?: string | null | undefined;
  base?: string | null | undefined;
}

export interface TrackedPull extends PullAddress {
  id: string;
  workspaceId: string;
  conversationId: string;
  taskId: string | null;
  url: string;
  title: string | null;
  branch: string;
  base: string | null;
  outside: boolean;
  followUp: boolean;
  openedVia: PrOpenedVia;
  openedBy: string | null;
  openedRunId: string | null;
  openedAt: Date;
  phase: PrWatchPhase;
  doing: string;
  prState: 'open' | 'merged' | 'closed';
  draft: boolean;
  checks: PrChecks;
  failingChecks: PrFailingCheck[];
  review: PrReview;
  details: StoredDetails;
  statusReason: string | null;
  headSha: string | null;
  additions: number | null;
  deletions: number | null;
  refreshRequested: boolean;
  rounds: number;
  roundRunId: string | null;
  approvalId: string | null;
  requested: boolean;
  knownReviewers: string[];
  quietHead: string | null;
  mergeRoundFor: string | null;
  roundOutcomes: RoundOutcome[];
  intervalSeconds: number;
  nextPollAt: Date;
  lastPolledAt: Date | null;
  pollProblem: PrPollProblem | null;
  lastError: string | null;
  ticketSync: PrTicketSync[];
  ticketSyncClaimedAt: Date | null;
  cleanHeadSha: string | null;
  cleanSince: Date | null;
}

export interface PullRow {
  id: string;
  workspace_id: string;
  conversation_id: string;
  task_id: string | null;
  host: string;
  owner: string;
  repo: string;
  number: number;
  url: string;
  title: string | null;
  branch: string;
  base: string | null;
  outside: boolean;
  follow_up: boolean;
  opened_via: PrOpenedVia;
  opened_by: string | null;
  opened_run_id: string | null;
  created_at: Date;
  phase: PrWatchPhase;
  doing: string;
  pr_state: TrackedPull['prState'];
  draft: boolean;
  checks: PrChecks;
  failing_checks: PrFailingCheck[];
  review: PrReview;
  details: unknown;
  status_reason: string | null;
  head_sha: string | null;
  additions: number | null;
  deletions: number | null;
  refresh_requested: boolean;
  rounds: number;
  round_run_id: string | null;
  approval_id: string | null;
  requested: boolean;
  known_reviewers: string[];
  quiet_head: string | null;
  merge_round_for: string | null;
  round_outcomes: unknown;
  interval_seconds: number;
  next_poll_at: Date;
  last_polled_at: Date | null;
  poll_problem: PrPollProblem | null;
  last_error: string | null;
  ticket_sync: unknown;
  ticket_sync_claimed_at: Date | null;
  clean_head_sha: string | null;
  clean_since: Date | null;
}

function parseTicketSync(value: unknown): PrTicketSync[] {
  const parsed = prTicketSyncSchema.array().safeParse(value);
  return parsed.success ? parsed.data : [];
}

export function toTrackedPull(row: PullRow): TrackedPull {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    conversationId: row.conversation_id,
    taskId: row.task_id,
    host: row.host,
    owner: row.owner,
    repo: row.repo,
    number: row.number,
    url: row.url,
    title: row.title,
    branch: row.branch,
    base: row.base,
    outside: row.outside,
    followUp: row.follow_up,
    openedVia: row.opened_via,
    openedBy: row.opened_by,
    openedRunId: row.opened_run_id,
    openedAt: row.created_at,
    phase: row.phase,
    doing: row.doing,
    prState: row.pr_state,
    draft: row.draft,
    checks: row.checks,
    failingChecks: row.failing_checks,
    review: row.review,
    details: parseDetails(row.details),
    statusReason: row.status_reason,
    headSha: row.head_sha,
    additions: row.additions,
    deletions: row.deletions,
    refreshRequested: row.refresh_requested,
    rounds: row.rounds,
    roundRunId: row.round_run_id,
    approvalId: row.approval_id,
    requested: row.requested,
    knownReviewers: row.known_reviewers,
    quietHead: row.quiet_head,
    mergeRoundFor: row.merge_round_for,
    roundOutcomes: roundOutcomesOf(row.round_outcomes),
    intervalSeconds: row.interval_seconds,
    nextPollAt: row.next_poll_at,
    lastPolledAt: row.last_polled_at,
    pollProblem: row.poll_problem,
    lastError: row.last_error,
    ticketSync: parseTicketSync(row.ticket_sync),
    ticketSyncClaimedAt: row.ticket_sync_claimed_at,
    cleanHeadSha: row.clean_head_sha,
    cleanSince: row.clean_since,
  };
}

const PULL_KEY = '(workspace_id, host, lower(owner), lower(repo), number)';

const KEEPS_OPENER = `pr_watches.conversation_id = EXCLUDED.conversation_id
  AND pr_watches.opened_via IN ('ship', 'agent')`;

const ADOPT = `ON CONFLICT ${PULL_KEY} DO UPDATE SET
  opened_via = CASE WHEN ${KEEPS_OPENER} THEN pr_watches.opened_via ELSE EXCLUDED.opened_via END,
  opened_by = CASE WHEN ${KEEPS_OPENER} THEN pr_watches.opened_by ELSE EXCLUDED.opened_by END,
  opened_run_id = CASE WHEN ${KEEPS_OPENER} THEN pr_watches.opened_run_id
    ELSE EXCLUDED.opened_run_id END,
  conversation_id = EXCLUDED.conversation_id, task_id = EXCLUDED.task_id,
  branch = EXCLUDED.branch, url = EXCLUDED.url, outside = EXCLUDED.outside,
  follow_up = EXCLUDED.follow_up, next_poll_at = now(), updated_at = now()`;

const KEEP = `ON CONFLICT ${PULL_KEY} DO NOTHING`;

const OPENED_HERE: ReadonlySet<PrOpenedVia> = new Set(['ship', 'agent', 'adopted']);

export interface Tracked {
  pull: TrackedPull;
  created: boolean;
}

export async function findTrackedPull(
  db: Queryable,
  workspaceId: string,
  address: PullAddress,
): Promise<TrackedPull | null> {
  const { rows } = await db.query<PullRow>(
    `SELECT * FROM pr_watches WHERE workspace_id = $1 AND host = $2 AND lower(owner) = lower($3)
       AND lower(repo) = lower($4) AND number = $5`,
    [workspaceId, address.host, address.owner, address.repo, address.number],
  );
  return rows[0] ? toTrackedPull(rows[0]) : null;
}

export async function trackPull(db: Queryable, target: TrackTarget): Promise<Tracked | null> {
  const { rows } = await db.query<PullRow & { inserted: boolean }>(
    `INSERT INTO pr_watches (id, workspace_id, conversation_id, task_id, host, owner, repo, number,
       url, branch, doing, draft, opened_via, opened_by, opened_run_id, outside, follow_up, title,
       base)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
     ${OPENED_HERE.has(target.via) ? ADOPT : KEEP}
     RETURNING *, (xmax = 0) AS inserted`,
    [
      newId(),
      target.workspaceId,
      target.conversationId,
      target.taskId,
      target.host,
      target.owner,
      target.repo,
      target.number,
      target.url,
      target.branch,
      target.followUp ? WATCHING_LINE : TRACKING_LINE,
      target.draft ?? false,
      target.via,
      target.by,
      target.runId,
      target.outside,
      target.followUp,
      target.title ?? null,
      target.base ?? null,
    ],
  );
  const row = rows[0];
  return row ? { pull: toTrackedPull(row), created: row.inserted } : null;
}

export async function trackedPullsOf(
  db: Queryable,
  workspaceId: string,
  conversationId: string,
): Promise<TrackedPull[]> {
  const { rows } = await db.query<PullRow>(
    `SELECT * FROM pr_watches WHERE workspace_id = $1 AND conversation_id = $2
     ORDER BY created_at DESC, number DESC`,
    [workspaceId, conversationId],
  );
  return rows.map(toTrackedPull);
}

const STILL_CHECKED = "(phase <> 'done' OR pr_state = 'closed')";

export async function duePulls(db: Queryable, now: Date, limit = 10): Promise<TrackedPull[]> {
  const { rows } = await db.query<PullRow>(
    `SELECT * FROM pr_watches
     WHERE (${STILL_CHECKED} OR refresh_requested) AND next_poll_at <= $1
     ORDER BY refresh_requested DESC, next_poll_at LIMIT $2`,
    [now, limit],
  );
  return rows.map(toTrackedPull);
}

export async function savePull(db: Queryable, pull: TrackedPull): Promise<void> {
  await db.query(
    `UPDATE pr_watches SET phase = $2, doing = $3, pr_state = $4, draft = $5, checks = $6,
       head_sha = $7, rounds = $8, round_run_id = $9, approval_id = $10, requested = $11,
       interval_seconds = $12, next_poll_at = $13, last_polled_at = $14, last_error = $15,
       title = $16, branch = $17, base = $18, failing_checks = $19, review = $20,
       status_reason = $21, follow_up = $22, details = $23, poll_problem = $24, additions = $25,
       deletions = $26, refresh_requested = $27, clean_head_sha = $28, clean_since = $29,
       known_reviewers = $30, quiet_head = $31, merge_round_for = $32,
       updated_at = now()
     WHERE id = $1`,
    [
      pull.id,
      pull.phase,
      pull.doing,
      pull.prState,
      pull.draft,
      pull.checks,
      pull.headSha,
      pull.rounds,
      pull.roundRunId,
      pull.approvalId,
      pull.requested,
      pull.intervalSeconds,
      pull.nextPollAt,
      pull.lastPolledAt,
      pull.lastError,
      pull.title,
      pull.branch,
      pull.base,
      JSON.stringify(pull.failingChecks),
      pull.review,
      pull.statusReason,
      pull.followUp,
      JSON.stringify(pull.details),
      pull.pollProblem,
      pull.additions,
      pull.deletions,
      pull.refreshRequested,
      pull.cleanHeadSha,
      pull.cleanSince,
      pull.knownReviewers,
      pull.quietHead,
      pull.mergeRoundFor,
    ],
  );
}

export async function pollChatPullsNow(
  db: Queryable,
  workspaceId: string,
  conversationId: string,
  staleBefore: Date,
): Promise<number> {
  const { rowCount } = await db.query(
    `UPDATE pr_watches SET next_poll_at = now()
     WHERE workspace_id = $1 AND conversation_id = $2 AND ${STILL_CHECKED} AND next_poll_at > now()
       AND (last_polled_at IS NULL OR last_polled_at <= $3)`,
    [workspaceId, conversationId, staleBefore],
  );
  return rowCount ?? 0;
}

export async function deferPulls(
  db: Queryable,
  workspaceId: string,
  host: string,
  until: Date,
  reason: string,
): Promise<void> {
  await db.query(
    `UPDATE pr_watches SET next_poll_at = $3, last_error = $4, poll_problem = 'rate_limit',
       updated_at = now()
     WHERE workspace_id = $1 AND host = $2 AND ${STILL_CHECKED} AND next_poll_at < $3`,
    [workspaceId, host, until, reason],
  );
}

export async function requestRefresh(
  db: Queryable,
  workspaceId: string,
  conversationId: string,
  id: string,
): Promise<TrackedPull | null> {
  const { rows } = await db.query<PullRow>(
    `UPDATE pr_watches SET refresh_requested = true, next_poll_at = now()
     WHERE id = $1 AND workspace_id = $2 AND conversation_id = $3 RETURNING *`,
    [id, workspaceId, conversationId],
  );
  return rows[0] ? toTrackedPull(rows[0]) : null;
}

export async function pullById(db: Queryable, id: string): Promise<TrackedPull | null> {
  const { rows } = await db.query<PullRow>('SELECT * FROM pr_watches WHERE id = $1', [id]);
  return rows[0] ? toTrackedPull(rows[0]) : null;
}
