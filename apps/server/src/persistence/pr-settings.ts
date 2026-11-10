import type { Queryable } from './db.ts';

export interface PrFollowUpSettings {
  enabled: boolean;
  fixChecks: boolean;
  handleReviews: boolean;
  reply: boolean;
  ask: boolean;
  bots: ReadonlySet<string>;
}

interface PrSettingsRow {
  pr_ready_for_review: boolean;
  pr_follow_up: boolean;
  pr_follow_up_checks: boolean;
  pr_follow_up_reviews: boolean;
  pr_follow_up_replies: boolean;
  pr_follow_up_ask: boolean;
  pr_follow_up_bots: string[];
}

const DEFAULTS: PrSettingsRow = {
  pr_ready_for_review: true,
  pr_follow_up: true,
  pr_follow_up_checks: true,
  pr_follow_up_reviews: true,
  pr_follow_up_replies: true,
  pr_follow_up_ask: false,
  pr_follow_up_bots: [],
};

async function prSettingsRow(db: Queryable, workspaceId: string): Promise<PrSettingsRow> {
  const { rows } = await db.query<PrSettingsRow>(
    `SELECT pr_ready_for_review, pr_follow_up, pr_follow_up_checks, pr_follow_up_reviews,
       pr_follow_up_replies, pr_follow_up_ask, pr_follow_up_bots
     FROM profiles WHERE workspace_id = $1`,
    [workspaceId],
  );
  return rows[0] ?? DEFAULTS;
}

export async function opensDraftPullRequests(db: Queryable, workspaceId: string): Promise<boolean> {
  return !(await prSettingsRow(db, workspaceId)).pr_ready_for_review;
}

export async function prFollowUpSettings(
  db: Queryable,
  workspaceId: string,
): Promise<PrFollowUpSettings> {
  const row = await prSettingsRow(db, workspaceId);
  return {
    enabled: row.pr_follow_up,
    fixChecks: row.pr_follow_up_checks,
    handleReviews: row.pr_follow_up_reviews,
    reply: row.pr_follow_up_replies,
    ask: row.pr_follow_up_ask,
    bots: new Set(row.pr_follow_up_bots.map((login) => login.toLowerCase())),
  };
}
