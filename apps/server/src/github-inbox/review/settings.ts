import {
  CREW_SLUG_PATTERN,
  type GithubReviewSettings,
  type GithubReviewSettingsUpdate,
  type GithubReviewerChoice,
} from '@spark-outpost/contracts';
import { BadRequestError } from '../../api/validation.ts';
import { stepSparks } from '../../crew-flows/step-sparks.ts';
import type { WorkflowStore } from '../../crew-flows/workflow-store.ts';
import type { Queryable } from '../../persistence/db.ts';

const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export interface StoredReviewSettings {
  reviewer: GithubReviewerChoice | null;
  autoReview: boolean;
  mayPost: boolean;
  mayApprove: boolean;
}

export const NO_REVIEW_SETTINGS: StoredReviewSettings = {
  reviewer: null,
  autoReview: false,
  mayPost: false,
  mayApprove: false,
};

interface SettingsRow {
  reviewer_kind: 'spark' | 'workflow' | null;
  reviewer_id: string | null;
  auto_review: boolean;
  may_post: boolean;
  may_approve: boolean;
}

export async function reviewSettings(
  db: Queryable,
  workspaceId: string,
): Promise<StoredReviewSettings> {
  const { rows } = await db.query<SettingsRow>(
    'SELECT * FROM github_review_settings WHERE workspace_id = $1',
    [workspaceId],
  );
  const row = rows[0];
  if (!row) return NO_REVIEW_SETTINGS;
  return {
    reviewer:
      row.reviewer_kind && row.reviewer_id
        ? { kind: row.reviewer_kind, id: row.reviewer_id }
        : null,
    autoReview: row.auto_review,
    mayPost: row.may_post,
    mayApprove: row.may_approve,
  };
}

export async function reviewerName(
  db: Queryable,
  workspaceId: string,
  store: WorkflowStore,
  reviewer: GithubReviewerChoice,
): Promise<string | null> {
  if (reviewer.kind === 'spark') {
    if (!UUID.test(reviewer.id)) return null;
    return (await stepSparks(db, workspaceId, [reviewer.id])).get(reviewer.id)?.name ?? null;
  }
  if (!CREW_SLUG_PATTERN.test(reviewer.id)) return null;
  return (await store.read(reviewer.id))?.workflow.name ?? null;
}

export async function settingsView(
  db: Queryable,
  workspaceId: string,
  store: WorkflowStore,
): Promise<GithubReviewSettings> {
  const stored = await reviewSettings(db, workspaceId);
  return {
    ...stored,
    reviewerName: stored.reviewer
      ? await reviewerName(db, workspaceId, store, stored.reviewer)
      : null,
  };
}

export async function saveReviewSettings(
  db: Queryable,
  workspaceId: string,
  store: WorkflowStore,
  update: GithubReviewSettingsUpdate,
): Promise<void> {
  if (update.reviewer && !(await reviewerName(db, workspaceId, store, update.reviewer))) {
    throw new BadRequestError('That Spark or workflow does not exist.');
  }
  if (update.autoReview && !update.reviewer) {
    throw new BadRequestError('Pick a reviewer before turning on auto-review.');
  }
  if (update.mayApprove && !update.mayPost) {
    throw new BadRequestError('Approving needs Reviewer may post to GitHub.');
  }
  await db.query(
    `INSERT INTO github_review_settings
       (workspace_id, reviewer_kind, reviewer_id, auto_review, may_post, may_approve)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (workspace_id) DO UPDATE SET
       reviewer_kind = EXCLUDED.reviewer_kind, reviewer_id = EXCLUDED.reviewer_id,
       auto_review = EXCLUDED.auto_review, may_post = EXCLUDED.may_post,
       may_approve = EXCLUDED.may_approve, updated_at = now()`,
    [
      workspaceId,
      update.reviewer?.kind ?? null,
      update.reviewer?.id ?? null,
      update.autoReview,
      update.mayPost,
      update.mayApprove,
    ],
  );
}
