import type { GithubReviewerKind } from '@spark-outpost/contracts';
import type { Queryable } from '../../persistence/db.ts';
import { newId } from '../../persistence/ids.ts';
import { pullKeyOf, type ReviewEnd } from './decide.ts';

export interface ReviewerSnapshot {
  kind: GithubReviewerKind;
  id: string;
  name: string;
}

export interface NewReview {
  workspaceId: string;
  pull: string;
  headSha: string;
  reviewer: ReviewerSnapshot;
  source: 'auto' | 'manual';
  dueAt: Date;
}

export async function enqueueReview(db: Queryable, review: NewReview): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO github_reviews (id, workspace_id, pull_id, pull_key, head_sha, reviewer_kind,
       reviewer_id, reviewer_name, source, due_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (workspace_id, pull_key) WHERE state = 'queued' DO UPDATE SET
       pull_id = EXCLUDED.pull_id,
       head_sha = EXCLUDED.head_sha,
       reviewer_kind = EXCLUDED.reviewer_kind,
       reviewer_id = EXCLUDED.reviewer_id,
       reviewer_name = EXCLUDED.reviewer_name,
       due_at = CASE WHEN github_reviews.source = 'manual' OR EXCLUDED.source = 'manual'
         THEN LEAST(github_reviews.due_at, EXCLUDED.due_at) ELSE EXCLUDED.due_at END,
       source = CASE WHEN github_reviews.source = 'manual' THEN 'manual' ELSE EXCLUDED.source END
     RETURNING id`,
    [
      newId(),
      review.workspaceId,
      review.pull,
      pullKeyOf(review.pull),
      review.headSha,
      review.reviewer.kind,
      review.reviewer.id,
      review.reviewer.name,
      review.source,
      review.dueAt,
    ],
  );
  return rows[0]!.id;
}

const COVERS_HEAD = `(state <> 'failed' OR workflow_run_id IS NOT NULL OR finished_at > $3)`;

export async function reviewedHeads(
  db: Queryable,
  workspaceId: string,
  pulls: readonly string[],
  retryFailedBefore: Date,
): Promise<Map<string, Set<string>>> {
  const heads = new Map<string, Set<string>>();
  if (pulls.length === 0) return heads;
  const { rows } = await db.query<{ pull_key: string; head_sha: string }>(
    `SELECT DISTINCT pull_key, head_sha FROM github_reviews
     WHERE workspace_id = $1 AND pull_key = ANY($2::text[]) AND ${COVERS_HEAD}`,
    [workspaceId, pulls.map(pullKeyOf), retryFailedBefore],
  );
  for (const row of rows) {
    const known = heads.get(row.pull_key) ?? new Set<string>();
    known.add(row.head_sha);
    heads.set(row.pull_key, known);
  }
  return heads;
}

export async function headCoveredByAnother(
  db: Queryable,
  claim: Pick<ClaimedReview, 'id' | 'workspaceId' | 'pull'>,
  headSha: string,
  retryFailedBefore: Date,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `SELECT 1 FROM github_reviews
     WHERE workspace_id = $1 AND pull_key = $2 AND ${COVERS_HEAD} AND head_sha = $4 AND id <> $5
     LIMIT 1`,
    [claim.workspaceId, pullKeyOf(claim.pull), retryFailedBefore, headSha, claim.id],
  );
  return rowCount === 1;
}

export async function dropUnstartedReview(db: Queryable, id: string): Promise<void> {
  await db.query(
    `DELETE FROM github_reviews WHERE id = $1 AND state = 'running' AND workflow_run_id IS NULL`,
    [id],
  );
}

export interface ClaimedReview {
  id: string;
  workspaceId: string;
  pull: string;
  headSha: string;
  reviewer: ReviewerSnapshot;
  source: 'auto' | 'manual';
}

interface ClaimRow {
  id: string;
  workspace_id: string;
  pull_id: string;
  head_sha: string;
  reviewer_kind: GithubReviewerKind;
  reviewer_id: string;
  reviewer_name: string;
  source: 'auto' | 'manual';
}

const toClaimed = (row: ClaimRow): ClaimedReview => ({
  id: row.id,
  workspaceId: row.workspace_id,
  pull: row.pull_id,
  headSha: row.head_sha,
  reviewer: { kind: row.reviewer_kind, id: row.reviewer_id, name: row.reviewer_name },
  source: row.source,
});

export async function claimDueReviews(
  db: Queryable,
  workspaceId: string,
  now: Date,
): Promise<ClaimedReview[]> {
  const { rows } = await db.query<ClaimRow>(
    `UPDATE github_reviews SET state = 'running', claimed_at = $2
     WHERE id IN (
       SELECT q.id FROM github_reviews q
       WHERE q.workspace_id = $1 AND q.state = 'queued' AND q.due_at <= $2
         AND NOT EXISTS (
           SELECT 1 FROM github_reviews r
           WHERE r.workspace_id = q.workspace_id AND r.pull_key = q.pull_key
             AND r.state = 'running'
         )
       ORDER BY q.due_at
       FOR UPDATE SKIP LOCKED
     ) AND state = 'queued'
     RETURNING *`,
    [workspaceId, now],
  );
  return rows.map(toClaimed);
}

export async function reclaimStrandedReviews(
  db: Queryable,
  workspaceId: string,
  now: Date,
  strandedMs: number,
): Promise<ClaimedReview[]> {
  const { rows } = await db.query<ClaimRow>(
    `UPDATE github_reviews SET claimed_at = $2
     WHERE workspace_id = $1 AND state = 'running' AND workflow_run_id IS NULL
       AND stop_requested_at IS NULL AND claimed_at < $3
     RETURNING *`,
    [workspaceId, now, new Date(now.getTime() - strandedMs)],
  );
  return rows.map(toClaimed);
}

export async function failReview(db: Queryable, id: string, error: string): Promise<void> {
  await db.query(
    `UPDATE github_reviews SET state = 'failed', error = $2, finished_at = now()
     WHERE id = $1 AND state IN ('queued', 'running')`,
    [id, error.slice(0, 2000)],
  );
}

export interface ReviewUsage {
  costUsd: number | null;
  tokens: number | null;
}

export async function settleReview(
  db: Queryable,
  id: string,
  end: ReviewEnd,
  usage: ReviewUsage,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE github_reviews SET state = $2, body = $3, error = $4, cost_usd = $5, tokens = $6,
       finished_at = now()
     WHERE id = $1 AND state = 'running'`,
    [id, end.state, end.body, end.error, usage.costUsd, usage.tokens],
  );
  return rowCount === 1;
}

export interface StopTarget {
  state: string;
  runId: string | null;
}

export async function requestStop(
  db: Queryable,
  workspaceId: string,
  id: string,
): Promise<StopTarget | null> {
  const queued = await db.query(
    `UPDATE github_reviews SET state = 'stopped', finished_at = now(),
       stop_requested_at = now()
     WHERE id = $1 AND workspace_id = $2 AND state = 'queued'`,
    [id, workspaceId],
  );
  if (queued.rowCount === 1) return { state: 'stopped', runId: null };
  const { rows } = await db.query<{ state: string; run_id: string | null }>(
    `UPDATE github_reviews g SET stop_requested_at = COALESCE(g.stop_requested_at, now())
     FROM (SELECT gr.id, w.run_id FROM github_reviews gr
           LEFT JOIN workflow_runs w ON w.id = gr.workflow_run_id
           WHERE gr.id = $1 AND gr.workspace_id = $2) found
     WHERE g.id = found.id
     RETURNING g.state, found.run_id`,
    [id, workspaceId],
  );
  const row = rows[0];
  return row ? { state: row.state, runId: row.run_id } : null;
}

export async function recordPost(
  db: Queryable,
  reviewId: string,
  post: { kind: 'comment' | 'approve'; githubId: string | null; url: string | null },
): Promise<void> {
  await db.query(
    `INSERT INTO github_review_posts (id, review_id, kind, github_id, url)
     VALUES ($1, $2, $3, $4, $5)`,
    [newId(), reviewId, post.kind, post.githubId, post.url],
  );
}
