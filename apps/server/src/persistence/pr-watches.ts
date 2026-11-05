import type {
  FeedbackItem,
  FeedbackKind,
  FeedbackState,
  FeedbackTriage,
} from '@spark-outpost/contracts';
import { plainExcerpt } from '../pr-tracking/plain-text.ts';
import type { Queryable } from './db.ts';
import { newId } from './ids.ts';
import {
  savePull,
  toTrackedPull,
  trackPull,
  type PullRow,
  type TrackedPull,
} from './tracked-pulls.ts';

export { WATCHING_LINE } from './tracked-pulls.ts';

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

export type Watch = TrackedPull & { taskId: string };

export function isWatch(pull: TrackedPull): pull is Watch {
  return pull.followUp && pull.taskId !== null;
}

const FOLLOWED = 'follow_up AND task_id IS NOT NULL';

export async function watchPullRequest(db: Queryable, target: WatchTarget): Promise<void> {
  await trackPull(db, {
    ...target,
    via: 'ship',
    by: null,
    runId: null,
    outside: false,
    followUp: true,
  });
}

function watches(rows: readonly PullRow[]): Watch[] {
  return rows.map(toTrackedPull).filter(isWatch);
}

export async function getWatch(db: Queryable, id: string): Promise<Watch | null> {
  const { rows } = await db.query<PullRow>(
    `SELECT * FROM pr_watches WHERE id = $1 AND ${FOLLOWED}`,
    [id],
  );
  return watches(rows)[0] ?? null;
}

export async function watchesForConversation(
  db: Queryable,
  workspaceId: string,
  conversationId: string,
): Promise<Watch[]> {
  const { rows } = await db.query<PullRow>(
    `SELECT * FROM pr_watches WHERE workspace_id = $1 AND conversation_id = $2 AND ${FOLLOWED}
     ORDER BY created_at DESC`,
    [workspaceId, conversationId],
  );
  return watches(rows);
}

export const saveWatch = savePull;

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
  const excerpt = plainExcerpt(item.body, excerptChars);
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

export async function pollWaitingRounds(db: Queryable, workspaceId: string): Promise<void> {
  await db.query(
    `UPDATE pr_watches w SET next_poll_at = now()
     WHERE w.workspace_id = $1 AND EXISTS (
       SELECT 1 FROM pr_feedback_items f WHERE f.watch_id = w.id AND f.state = 'queued'
     )`,
    [workspaceId],
  );
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
