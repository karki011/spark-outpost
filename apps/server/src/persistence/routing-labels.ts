import type { Queryable } from './db.ts';

export interface RoutingLabelRow {
  run_id: string;
  task_id: string | null;
  conversation_id: string;
  created_at: Date;
  status: string;
  request: string;
  policy_version: string | null;
  policy: string | null;
  candidates: unknown;
  rule_route: unknown;
  code_pick: unknown;
  tier_pick: unknown;
  jev_text: unknown;
  jev_evidence: unknown;
  builder_route: unknown;
  scan_status: string | null;
  scan_ms: number | null;
  scan_files: string[] | null;
  predicted_files: string[] | null;
  rank_stage_one: unknown;
  rank_stage_two: unknown;
  changed_files: string[] | null;
  checks: unknown;
  verify: string[] | null;
  critic: string[] | null;
  escalated: boolean | null;
  keep_revert: 'kept' | 'reverted' | null;
  thumbs: 'up' | 'down' | null;
  jev_tokens: number;
  jev_cost_usd: string | number;
}

export interface LabelFilter {
  since?: Date;
  runIds?: readonly string[];
}

export async function routingLabels(
  db: Queryable,
  filter: LabelFilter = {},
): Promise<RoutingLabelRow[]> {
  const { rows } = await db.query<RoutingLabelRow>(
    `SELECT * FROM routing_labels
     WHERE ($1::timestamptz IS NULL OR created_at >= $1)
       AND ($2::uuid[] IS NULL OR run_id = ANY($2::uuid[]))
     ORDER BY created_at`,
    [filter.since ?? null, filter.runIds ?? null],
  );
  return rows;
}
