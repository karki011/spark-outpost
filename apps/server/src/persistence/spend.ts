import {
  mergeCostSource,
  type ProviderTotals,
  type SpendRange,
  type SpendSummary,
  type TotalCostSource,
} from '@spark-outpost/contracts';
import type { TierModel } from '../orchestration/tiers.ts';
import { routingSavings, tallySavings, type RoutedRun } from '../usage/routing-savings.ts';
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

interface JevRow {
  calls: number;
  input_tokens: number;
  cost_usd: number;
}

interface RoutedRow {
  provider: string;
  model: string | null;
  model_label: string | null;
  input_tokens: number;
  output_tokens: number;
  cached_read_tokens: number | null;
  cached_write_tokens: number | null;
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

async function jevTotals(db: Queryable, workspaceId: string, since: Date): Promise<JevRow> {
  const { rows } = await db.query<JevRow>(
    `SELECT
       count(*) FILTER (WHERE a.jev_status NOT IN ('not_connected', 'not_asked'))::int AS calls,
       COALESCE(sum(a.jev_input_tokens), 0)::int AS input_tokens,
       COALESCE(sum(a.jev_cost_usd), 0)::float8 AS cost_usd
     FROM run_advice a
     JOIN runs r ON r.id = a.run_id JOIN conversations c ON c.id = r.conversation_id
     WHERE c.workspace_id = $1 AND a.created_at >= $2`,
    [workspaceId, since],
  );
  return rows[0] ?? { calls: 0, input_tokens: 0, cost_usd: 0 };
}

function jevSlice(jev: JevRow): ProviderTotals[] {
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

async function routedRuns(db: Queryable, workspaceId: string, since: Date): Promise<RoutedRun[]> {
  const { rows } = await db.query<RoutedRow>(
    `SELECT r.provider, COALESCE(r.used_model, r.model) AS model,
       r.route->>'modelLabel' AS model_label, r.input_tokens, r.output_tokens,
       r.cached_read_tokens, r.cached_write_tokens
     FROM runs r JOIN conversations c ON c.id = r.conversation_id
     WHERE c.workspace_id = $1 AND r.created_at >= $2
       AND r.route->>'routedBy' = 'jev'
       AND r.input_tokens IS NOT NULL AND r.output_tokens IS NOT NULL`,
    [workspaceId, since],
  );
  return rows.map((row) => ({
    provider: row.provider,
    model: row.model,
    modelLabel: row.model_label,
    tokens: {
      input: row.input_tokens,
      output: row.output_tokens,
      cachedRead: row.cached_read_tokens,
      cachedWrite: row.cached_write_tokens,
    },
  }));
}

async function offeredModels(
  db: Queryable,
  workspaceId: string,
): Promise<Map<string, TierModel[]>> {
  const { rows } = await db.query<{ provider: string; models: { id: string; label?: string }[] }>(
    'SELECT provider, models FROM provider_capabilities WHERE workspace_id = $1',
    [workspaceId],
  );
  return new Map(
    rows.map((row) => [
      row.provider,
      row.models.map((model) => ({ id: model.id, label: model.label ?? '' })),
    ]),
  );
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
  const [agents, jev, routed, offered] = await Promise.all([
    providerTotals(db, workspaceId, since),
    jevTotals(db, workspaceId, since),
    routedRuns(db, workspaceId, since),
    offeredModels(db, workspaceId),
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
    savings: routingSavings(tallySavings(routed, offered), jev.cost_usd),
  };
}
