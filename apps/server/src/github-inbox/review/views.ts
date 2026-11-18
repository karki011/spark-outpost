import type {
  GithubReview,
  GithubReviewPostKind,
  GithubReviewState,
  GithubReviewerKind,
} from '@spark-outpost/contracts';
import type { Queryable } from '../../persistence/db.ts';
import { pullKeyOf, type LatestReview } from './decide.ts';

interface ReviewRow {
  id: string;
  pull_id: string;
  head_sha: string;
  reviewer_kind: GithubReviewerKind;
  reviewer_id: string;
  reviewer_name: string;
  state: GithubReviewState;
  body: string | null;
  error: string | null;
  requested_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  cost_usd: string | null;
  tokens: string | null;
}

interface PostRow {
  review_id: string;
  kind: GithubReviewPostKind;
  url: string | null;
  posted_at: Date;
}

const iso = (date: Date | null) => (date ? date.toISOString() : null);

async function postsOf(db: Queryable, ids: readonly string[]): Promise<Map<string, PostRow[]>> {
  const posts = new Map<string, PostRow[]>();
  if (ids.length === 0) return posts;
  const { rows } = await db.query<PostRow>(
    `SELECT review_id, kind, url, posted_at FROM github_review_posts
     WHERE review_id = ANY($1::uuid[]) ORDER BY posted_at, id`,
    [ids],
  );
  for (const row of rows) posts.set(row.review_id, [...(posts.get(row.review_id) ?? []), row]);
  return posts;
}

function toReview(row: ReviewRow, posts: readonly PostRow[]): GithubReview {
  return {
    id: row.id,
    pull: row.pull_id,
    headSha: row.head_sha,
    reviewer: { kind: row.reviewer_kind, id: row.reviewer_id, name: row.reviewer_name },
    state: row.state,
    body: row.body,
    error: row.error,
    requestedAt: row.requested_at.toISOString(),
    startedAt: iso(row.started_at),
    finishedAt: iso(row.finished_at),
    posted: posts.map((post) => ({
      kind: post.kind,
      url: post.url,
      at: post.posted_at.toISOString(),
    })),
    costUsd: row.cost_usd === null ? null : Number(row.cost_usd),
    tokens: row.tokens === null ? null : Number(row.tokens),
  };
}

const REVIEW_COLUMNS = `id, pull_id, head_sha, reviewer_kind, reviewer_id, reviewer_name, state,
  body, error, requested_at, started_at, finished_at, cost_usd, tokens`;

export async function listReviews(
  db: Queryable,
  workspaceId: string,
  pull: string,
): Promise<GithubReview[]> {
  const { rows } = await db.query<ReviewRow>(
    `SELECT ${REVIEW_COLUMNS} FROM github_reviews WHERE workspace_id = $1 AND pull_key = $2
     ORDER BY requested_at DESC, id`,
    [workspaceId, pullKeyOf(pull)],
  );
  const posts = await postsOf(
    db,
    rows.map((row) => row.id),
  );
  return rows.map((row) => toReview(row, posts.get(row.id) ?? []));
}

export async function getReview(
  db: Queryable,
  workspaceId: string,
  id: string,
): Promise<GithubReview | null> {
  const { rows } = await db.query<ReviewRow>(
    `SELECT ${REVIEW_COLUMNS} FROM github_reviews WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, id],
  );
  const row = rows[0];
  if (!row) return null;
  return toReview(row, (await postsOf(db, [row.id])).get(row.id) ?? []);
}

export async function latestReviews(
  db: Queryable,
  workspaceId: string,
  pulls: readonly string[],
): Promise<Map<string, LatestReview>> {
  const latest = new Map<string, LatestReview>();
  if (pulls.length === 0) return latest;
  const { rows } = await db.query<{
    id: string;
    pull_key: string;
    state: GithubReviewState;
    head_sha: string;
  }>(
    `SELECT DISTINCT ON (pull_key) id, pull_key, state, head_sha FROM github_reviews
     WHERE workspace_id = $1 AND pull_key = ANY($2::text[])
     ORDER BY pull_key, requested_at DESC, id`,
    [workspaceId, pulls.map(pullKeyOf)],
  );
  const posts = await postsOf(
    db,
    rows.map((row) => row.id),
  );
  for (const row of rows) {
    latest.set(row.pull_key, {
      state: row.state,
      headSha: row.head_sha,
      posted: (posts.get(row.id) ?? []).map((post) => post.kind),
    });
  }
  return latest;
}

export interface RunReview {
  id: string;
  workspaceId: string;
  pull: string;
  headSha: string;
  state: GithubReviewState;
  stopping: boolean;
}

export async function reviewForRun(db: Queryable, runId: string): Promise<RunReview | null> {
  const { rows } = await db.query<{
    id: string;
    workspace_id: string;
    pull_id: string;
    head_sha: string;
    state: GithubReviewState;
    stopping: boolean;
  }>(
    `SELECT g.id, g.workspace_id, g.pull_id, g.head_sha, g.state,
            g.stop_requested_at IS NOT NULL AS stopping
     FROM runs r
     JOIN workflow_runs w ON w.run_id = COALESCE(r.parent_run_id, r.id) AND w.kind = 'review'
     JOIN github_reviews g ON g.workflow_run_id = w.id
     WHERE r.id = $1`,
    [runId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    pull: row.pull_id,
    headSha: row.head_sha,
    state: row.state,
    stopping: row.stopping,
  };
}

export interface ReviewJob {
  material: string;
  pull: string;
}

export async function reviewJobFor(
  db: Queryable,
  workflowRunId: string,
): Promise<ReviewJob | null> {
  const { rows } = await db.query<{ material: string | null; pull_id: string }>(
    'SELECT material, pull_id FROM github_reviews WHERE workflow_run_id = $1',
    [workflowRunId],
  );
  const row = rows[0];
  return row?.material ? { material: row.material, pull: row.pull_id } : null;
}

export async function earlierReview(
  db: Queryable,
  workspaceId: string,
  pull: string,
  reviewer: { kind: GithubReviewerKind; id: string },
  exceptId: string,
): Promise<{ headSha: string; body: string } | null> {
  const { rows } = await db.query<{ head_sha: string; body: string }>(
    `SELECT head_sha, body FROM github_reviews
     WHERE workspace_id = $1 AND pull_key = $2 AND reviewer_kind = $3 AND reviewer_id = $4
       AND state = 'done' AND body IS NOT NULL AND id <> $5
     ORDER BY finished_at DESC LIMIT 1`,
    [workspaceId, pullKeyOf(pull), reviewer.kind, reviewer.id, exceptId],
  );
  const row = rows[0];
  return row ? { headSha: row.head_sha, body: row.body } : null;
}
