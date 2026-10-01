import type {
  FeedbackItem,
  FeedbackKind,
  FeedbackState,
  FeedbackTriage,
  PrChecks,
  PrWatchPhase,
} from '@spark-outpost/contracts';
import type { Queryable } from './db.ts';
import { newId } from './ids.ts';

export interface WatchTarget {
  workspaceId: string;
  conversationId: string;
  taskId: string;
  host: string;
  owner: string;
  repo: string;
  number: number;
  url: string;
  branch: string;
  draft?: boolean;
}

export interface Watch extends Required<WatchTarget> {
  id: string;
  phase: PrWatchPhase;
  doing: string;
  prState: 'open' | 'merged' | 'closed';
  draft: boolean;
  checks: PrChecks;
  headSha: string | null;
  rounds: number;
  roundRunId: string | null;
  approvalId: string | null;
  requested: boolean;
  intervalSeconds: number;
  nextPollAt: Date;
  lastPolledAt: Date | null;
  lastError: string | null;
}

interface WatchRow {
  id: string;
  workspace_id: string;
  conversation_id: string;
  task_id: string;
  host: string;
  owner: string;
  repo: string;
  number: number;
  url: string;
  branch: string;
  phase: PrWatchPhase;
  doing: string;
  pr_state: Watch['prState'];
  draft: boolean;
  checks: PrChecks;
  head_sha: string | null;
  rounds: number;
  round_run_id: string | null;
  approval_id: string | null;
  requested: boolean;
  interval_seconds: number;
  next_poll_at: Date;
  last_polled_at: Date | null;
  last_error: string | null;
}

export const WATCHING_LINE = 'Watching checks and reviews.';

function toWatch(row: WatchRow): Watch {
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
    branch: row.branch,
    phase: row.phase,
    doing: row.doing,
    prState: row.pr_state,
    draft: row.draft,
    checks: row.checks,
    headSha: row.head_sha,
    rounds: row.rounds,
    roundRunId: row.round_run_id,
    approvalId: row.approval_id,
    requested: row.requested,
    intervalSeconds: row.interval_seconds,
    nextPollAt: row.next_poll_at,
    lastPolledAt: row.last_polled_at,
    lastError: row.last_error,
  };
}

export async function watchPullRequest(db: Queryable, target: WatchTarget): Promise<void> {
  await db.query(
    `INSERT INTO pr_watches (id, workspace_id, conversation_id, task_id, host, owner, repo, number,
       url, branch, doing, draft)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (workspace_id, host, owner, repo, number) DO UPDATE SET
       conversation_id = EXCLUDED.conversation_id, task_id = EXCLUDED.task_id,
       branch = EXCLUDED.branch, url = EXCLUDED.url, next_poll_at = now(), updated_at = now()`,
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
      WATCHING_LINE,
      target.draft ?? false,
    ],
  );
}

export async function dueWatches(db: Queryable, now: Date, limit = 10): Promise<Watch[]> {
  const { rows } = await db.query<WatchRow>(
    `SELECT * FROM pr_watches WHERE phase <> 'done' AND next_poll_at <= $1
     ORDER BY next_poll_at LIMIT $2`,
    [now, limit],
  );
  return rows.map(toWatch);
}

export async function getWatch(db: Queryable, id: string): Promise<Watch | null> {
  const { rows } = await db.query<WatchRow>('SELECT * FROM pr_watches WHERE id = $1', [id]);
  return rows[0] ? toWatch(rows[0]) : null;
}

export async function watchesForConversation(
  db: Queryable,
  workspaceId: string,
  conversationId: string,
): Promise<Watch[]> {
  const { rows } = await db.query<WatchRow>(
    `SELECT * FROM pr_watches WHERE workspace_id = $1 AND conversation_id = $2
     ORDER BY created_at DESC`,
    [workspaceId, conversationId],
  );
  return rows.map(toWatch);
}

export async function saveWatch(db: Queryable, watch: Watch): Promise<void> {
  await db.query(
    `UPDATE pr_watches SET phase = $2, doing = $3, pr_state = $4, draft = $5, checks = $6,
       head_sha = $7, rounds = $8, round_run_id = $9, approval_id = $10, requested = $11,
       interval_seconds = $12, next_poll_at = $13, last_polled_at = $14, last_error = $15,
       updated_at = now()
     WHERE id = $1`,
    [
      watch.id,
      watch.phase,
      watch.doing,
      watch.prState,
      watch.draft,
      watch.checks,
      watch.headSha,
      watch.rounds,
      watch.roundRunId,
      watch.approvalId,
      watch.requested,
      watch.intervalSeconds,
      watch.nextPollAt,
      watch.lastPolledAt,
      watch.lastError,
    ],
  );
}

export async function pollNow(db: Queryable, watchId: string): Promise<void> {
  await db.query('UPDATE pr_watches SET next_poll_at = now() WHERE id = $1', [watchId]);
}

export interface NewFeedback {
  sourceKey: string;
  kind: FeedbackKind;
  githubId: string;
  author: string;
  trusted: boolean;
  path: string | null;
  line: number | null;
  body: string;
  url: string | null;
}

export interface StoredFeedback extends NewFeedback {
  id: string;
  label: string;
  triage: FeedbackTriage;
  triagedBy: 'jev' | 'rules';
  state: FeedbackState;
  round: number | null;
  reply: string | null;
  replyId: string | null;
}

interface ItemRow {
  id: string;
  source_key: string;
  label: string;
  kind: FeedbackKind;
  github_id: string;
  author: string;
  trusted: boolean;
  path: string | null;
  line: number | null;
  body: string;
  url: string | null;
  triage: FeedbackTriage;
  triaged_by: 'jev' | 'rules';
  state: FeedbackState;
  round: number | null;
  reply: string | null;
  reply_id: string | null;
}

function toItem(row: ItemRow): StoredFeedback {
  return {
    id: row.id,
    sourceKey: row.source_key,
    label: row.label,
    kind: row.kind,
    githubId: row.github_id,
    author: row.author,
    trusted: row.trusted,
    path: row.path,
    line: row.line,
    body: row.body,
    url: row.url,
    triage: row.triage,
    triagedBy: row.triaged_by,
    state: row.state,
    round: row.round,
    reply: row.reply,
    replyId: row.reply_id,
  };
}

export async function knownSourceKeys(db: Queryable, watchId: string): Promise<Set<string>> {
  const { rows } = await db.query<{ source_key: string }>(
    'SELECT source_key FROM pr_feedback_items WHERE watch_id = $1',
    [watchId],
  );
  return new Set(rows.map((row) => row.source_key));
}

export type TriagedFeedback = NewFeedback & Pick<StoredFeedback, 'triage' | 'triagedBy' | 'state'>;

export async function insertFeedback(
  db: Queryable,
  watchId: string,
  items: readonly TriagedFeedback[],
): Promise<StoredFeedback[]> {
  const { rows: counted } = await db.query<{ count: number }>(
    'SELECT count(*)::int AS count FROM pr_feedback_items WHERE watch_id = $1',
    [watchId],
  );
  let next = counted[0]?.count ?? 0;
  const stored: StoredFeedback[] = [];
  for (const item of items) {
    next += 1;
    const { rows } = await db.query<ItemRow>(
      `INSERT INTO pr_feedback_items (id, watch_id, source_key, label, kind, github_id, author,
         trusted, path, line, body, url, triage, triaged_by, state)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       ON CONFLICT (watch_id, source_key) DO NOTHING RETURNING *`,
      [
        newId(),
        watchId,
        item.sourceKey,
        `F${next}`,
        item.kind,
        item.githubId,
        item.author,
        item.trusted,
        item.path,
        item.line,
        item.body,
        item.url,
        item.triage,
        item.triagedBy,
        item.state,
      ],
    );
    if (rows[0]) stored.push(toItem(rows[0]));
  }
  return stored;
}

export async function feedbackFor(
  db: Queryable,
  watchId: string,
  states?: readonly FeedbackState[],
): Promise<StoredFeedback[]> {
  const { rows } = await db.query<ItemRow>(
    `SELECT * FROM pr_feedback_items WHERE watch_id = $1
       AND ($2::text[] IS NULL OR state = ANY($2::text[]))
     ORDER BY created_at, label`,
    [watchId, states ?? null],
  );
  return rows.map(toItem);
}

export interface FeedbackUpdate {
  state: FeedbackState;
  round?: number | null;
  reply?: string | null;
  replyId?: string | null;
}

export async function updateFeedback(
  db: Queryable,
  ids: readonly string[],
  update: FeedbackUpdate,
): Promise<void> {
  if (ids.length === 0) return;
  await db.query(
    `UPDATE pr_feedback_items SET state = $2,
       round = CASE WHEN $3 THEN $4::int ELSE round END,
       reply = CASE WHEN $5 THEN $6 ELSE reply END,
       reply_id = CASE WHEN $7 THEN $8 ELSE reply_id END,
       updated_at = now()
     WHERE id = ANY($1::uuid[])`,
    [
      ids,
      update.state,
      update.round !== undefined,
      update.round ?? null,
      update.reply !== undefined,
      update.reply ?? null,
      update.replyId !== undefined,
      update.replyId ?? null,
    ],
  );
}

export function feedbackView(item: StoredFeedback, excerptChars = 280): FeedbackItem {
  const excerpt =
    item.body.length > excerptChars ? `${item.body.slice(0, excerptChars - 1)}…` : item.body;
  return {
    id: item.id,
    label: item.label,
    kind: item.kind,
    author: item.author,
    trusted: item.trusted,
    path: item.path,
    line: item.line,
    excerpt,
    url: item.url,
    triage: item.triage,
    triagedBy: item.triagedBy,
    state: item.state,
    round: item.round,
    reply: item.reply,
  };
}

export async function pollNowForApproval(db: Queryable, approvalId: string): Promise<boolean> {
  const { rowCount } = await db.query(
    "UPDATE pr_watches SET next_poll_at = now() WHERE approval_id = $1 AND phase = 'confirming'",
    [approvalId],
  );
  return (rowCount ?? 0) > 0;
}

export async function prFeedbackWaiting(
  db: Queryable,
  workspaceId: string,
  urls: readonly string[],
): Promise<Map<string, { number: number; waiting: number; since: string }>> {
  if (urls.length === 0) return new Map();
  const { rows } = await db.query<{ url: string; number: number; waiting: number; since: Date }>(
    `SELECT w.url, w.number, count(*)::int AS waiting, min(i.updated_at) AS since
     FROM pr_watches w JOIN pr_feedback_items i ON i.watch_id = w.id
     WHERE w.workspace_id = $1 AND w.url = ANY($2::text[]) AND w.phase <> 'done'
       AND i.state = 'needs_user'
     GROUP BY w.url, w.number`,
    [workspaceId, urls],
  );
  return new Map(
    rows.map((row) => [
      row.url,
      { number: row.number, waiting: row.waiting, since: row.since.toISOString() },
    ]),
  );
}
