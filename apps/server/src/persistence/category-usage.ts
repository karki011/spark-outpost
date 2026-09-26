import {
  categorySchema,
  type CategoryTotals,
  type TotalCostSource,
} from '@spark-outpost/contracts';
import type { Queryable } from './db.ts';

interface CategoryRow {
  category: string | null;
  turns: number;
  cost_usd: number | null;
  total_tokens: number;
  reported: boolean;
  estimated: boolean;
}

function costSource(row: CategoryRow): TotalCostSource | null {
  if (row.reported && row.estimated) return 'mixed';
  if (row.estimated) return 'estimated';
  return row.reported ? 'reported' : null;
}

function toTotals(row: CategoryRow): CategoryTotals {
  return {
    category: categorySchema.safeParse(row.category).data ?? null,
    turns: row.turns,
    costUsd: row.cost_usd,
    costSource: costSource(row),
    totalTokens: row.total_tokens,
  };
}

export async function categoryUsage(
  db: Queryable,
  workspaceId: string,
): Promise<{ last30Days: CategoryTotals[]; allTime: CategoryTotals[] }> {
  const query = (recentOnly: boolean) =>
    db.query<CategoryRow>(
      `SELECT COALESCE(p.category, r.category) AS category,
         (count(*) FILTER (WHERE r.parent_run_id IS NULL))::int AS turns,
         sum(r.cost_usd)::float8 AS cost_usd,
         COALESCE(sum(COALESCE(r.total_tokens, r.input_tokens + r.output_tokens, 0)), 0)::float8
           AS total_tokens,
         COALESCE(bool_or(r.cost_usd IS NOT NULL AND r.cost_source IS DISTINCT FROM 'estimated'),
           false) AS reported,
         COALESCE(bool_or(r.cost_usd IS NOT NULL AND r.cost_source = 'estimated'), false)
           AS estimated
       FROM runs r
       JOIN conversations c ON c.id = r.conversation_id
       LEFT JOIN runs p ON p.id = r.parent_run_id
       WHERE c.workspace_id = $1
         AND ($2::boolean IS FALSE OR COALESCE(p.created_at, r.created_at) >= now() - interval '30 days')
       GROUP BY 1
       ORDER BY sum(r.cost_usd) DESC NULLS LAST, 2 DESC`,
      [workspaceId, recentOnly],
    );
  const [recent, all] = await Promise.all([query(true), query(false)]);
  return { last30Days: recent.rows.map(toTotals), allTime: all.rows.map(toTotals) };
}
