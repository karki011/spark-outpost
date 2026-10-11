import {
  adviceSummarySchema,
  type AdviceSummary,
  type AdvisorUsage,
} from '@spark-outpost/contracts';
import type { Queryable } from './db.ts';

export interface JevUsageRow {
  calls: number;
  input_tokens: number;
  cost_usd: number;
}

export const JEV_USAGE_COLUMNS = `
  count(*) FILTER (WHERE a.jev_status NOT IN ('not_connected', 'not_asked'))::int AS calls,
  COALESCE(sum(a.jev_input_tokens), 0)::int AS input_tokens,
  COALESCE(sum(a.jev_cost_usd), 0)::float8 AS cost_usd`;

function toUsage(row: JevUsageRow | undefined): AdvisorUsage[] {
  if (!row || row.calls === 0) return [];
  return [
    { advisor: 'jev', calls: row.calls, inputTokens: row.input_tokens, costUsd: row.cost_usd },
  ];
}

export interface ConversationAdvice {
  byRun: Record<string, AdviceSummary>;
  usage: AdvisorUsage[];
}

export async function conversationAdvice(
  db: Queryable,
  conversationId: string,
): Promise<ConversationAdvice> {
  const { rows } = await db.query<{ run_id: string; body: unknown }>(
    `SELECT a.run_id, a.body FROM run_advice a JOIN runs r ON r.id = a.run_id
     WHERE r.conversation_id = $1 AND a.purpose = 'intake'`,
    [conversationId],
  );
  const byRun: Record<string, AdviceSummary> = {};
  for (const row of rows) {
    const summary = adviceSummarySchema.safeParse(row.body);
    if (summary.success) byRun[row.run_id] = summary.data;
  }
  const usage = await db.query<JevUsageRow>(
    `SELECT ${JEV_USAGE_COLUMNS} FROM run_advice a JOIN runs r ON r.id = a.run_id
     WHERE r.conversation_id = $1`,
    [conversationId],
  );
  return { byRun, usage: toUsage(usage.rows[0]) };
}

export async function advisorUsageForRuns(
  db: Queryable,
  runIds: readonly string[],
): Promise<AdvisorUsage[]> {
  const { rows } = await db.query<JevUsageRow>(
    `SELECT ${JEV_USAGE_COLUMNS} FROM run_advice a WHERE a.run_id = ANY($1::uuid[])`,
    [runIds],
  );
  return toUsage(rows[0]);
}

export async function advisorUsageSummary(
  db: Queryable,
  workspaceId: string,
): Promise<{ last30Days: AdvisorUsage[]; allTime: AdvisorUsage[] }> {
  const query = (recentOnly: boolean) =>
    db.query<JevUsageRow>(
      `SELECT ${JEV_USAGE_COLUMNS} FROM run_advice a
       JOIN runs r ON r.id = a.run_id JOIN conversations c ON c.id = r.conversation_id
       WHERE c.workspace_id = $1
         AND ($2::boolean IS FALSE OR a.created_at >= now() - interval '30 days')`,
      [workspaceId, recentOnly],
    );
  const [recent, all] = await Promise.all([query(true), query(false)]);
  return { last30Days: toUsage(recent.rows[0]), allTime: toUsage(all.rows[0]) };
}
