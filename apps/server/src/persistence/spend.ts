import {
  mergeCostSource,
  type ProviderTotals,
  type SpendRange,
  type SpendSummary,
  type TotalCostSource,
} from '@spark-outpost/contracts';
import { JEV_USAGE_COLUMNS, type JevUsageRow } from './advice.ts';
import type { Queryable } from './db.ts';

const TRUNC_UNIT: Record<SpendRange, string> = { today: 'day', week: 'week' };

interface ProviderRow {
  provider: string;
  runs: number;
  cost_usd: number | null;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  reported: boolean;
  estimated: boolean;
}

function totalSource(reported: boolean, estimated: boolean): TotalCostSource | null {
  if (reported && estimated) return 'mixed';
  if (estimated) return 'estimated';
  return reported ? 'reported' : null;
}

async function rangeStart(db: Queryable, range: SpendRange, timeZone: string): Promise<Date> {
  const { rows } = await db.query<{ since: Date }>(
    'SELECT (date_trunc($1, now() AT TIME ZONE $2) AT TIME ZONE $2) AS since',
    [TRUNC_UNIT[range], timeZone],
  );
  return rows[0]!.since;
}

async function providerTotals(
  db: Queryable,
  workspaceId: string,
  since: Date,
): Promise<ProviderTotals[]> {
  const { rows } = await db.query<ProviderRow>(
    `SELECT r.provider,
       count(*)::int AS runs,
       sum(r.cost_usd)::float8 AS cost_usd,
       COALESCE(sum(r.input_tokens), 0)::float8 AS input_tokens,
       COALESCE(sum(r.output_tokens), 0)::float8 AS output_tokens,
       COALESCE(sum(COALESCE(r.total_tokens, r.input_tokens + r.output_tokens, 0)), 0)::float8
         AS total_tokens,
       COALESCE(bool_or(r.cost_usd IS NOT NULL AND r.cost_source IS DISTINCT FROM 'estimated'),
         false) AS reported,
       COALESCE(bool_or(r.cost_usd IS NOT NULL AND r.cost_source = 'estimated'), false)
         AS estimated
     FROM runs r JOIN conversations c ON c.id = r.conversation_id
     WHERE c.workspace_id = $1 AND r.created_at >= $2
     GROUP BY r.provider ORDER BY r.provider`,
    [workspaceId, since],
  );
  return rows.map((row) => ({
    provider: row.provider,
    runs: row.runs,
    costUsd: row.cost_usd,
    costSource: totalSource(row.reported, row.estimated),
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    totalTokens: row.total_tokens,
  }));
}

async function jevTotals(db: Queryable, workspaceId: string, since: Date): Promise<JevUsageRow> {
  const { rows } = await db.query<JevUsageRow>(
    `SELECT ${JEV_USAGE_COLUMNS}
     FROM run_advice a
     JOIN runs r ON r.id = a.run_id JOIN conversations c ON c.id = r.conversation_id
     WHERE c.workspace_id = $1 AND a.created_at >= $2`,
    [workspaceId, since],
  );
  return rows[0] ?? { calls: 0, input_tokens: 0, cost_usd: 0 };
}

function jevSlice(jev: JevUsageRow): ProviderTotals[] {
  if (jev.calls === 0) return [];
  return [
    {
      provider: 'jev',
      runs: jev.calls,
      costUsd: jev.cost_usd,
      costSource: 'estimated',
      inputTokens: jev.input_tokens,
      outputTokens: 0,
      totalTokens: jev.input_tokens,
    },
  ];
}

function sumCost(rows: readonly ProviderTotals[]): number | null {
  return rows.reduce<number | null>(
    (total, row) => (row.costUsd === null ? total : (total ?? 0) + row.costUsd),
    null,
  );
}

export async function spendSummary(
  db: Queryable,
  workspaceId: string,
  range: SpendRange,
  timeZone: string,
): Promise<SpendSummary> {
  const since = await rangeStart(db, range, timeZone);
  const [agents, jev] = await Promise.all([
    providerTotals(db, workspaceId, since),
    jevTotals(db, workspaceId, since),
  ]);
  const byProvider = [...agents, ...jevSlice(jev)];
  return {
    range,
    since: since.toISOString(),
    runs: agents.reduce((sum, row) => sum + row.runs, 0),
    costUsd: sumCost(byProvider),
    costSource: byProvider.reduce<TotalCostSource | null>(
      (source, row) =>
        mergeCostSource(source, row.costUsd === null ? null : (row.costSource ?? null)),
      null,
    ),
    totalTokens: byProvider.reduce((sum, row) => sum + row.totalTokens, 0),
    byProvider,
  };
}
