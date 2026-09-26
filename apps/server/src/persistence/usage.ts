import {
  mergeCostSource,
  type ConversationUsage,
  type ProviderChatUsage,
  type ProviderTotals,
  type Run,
  type TotalCostSource,
  type UsageSummary,
} from '@spark-outpost/contracts';
import type { Queryable } from './db.ts';

function addCost(total: number | null, cost: number | null): number | null {
  if (cost === null) return total;
  return (total ?? 0) + cost;
}

function emptyProvider(provider: string): ProviderChatUsage {
  return {
    provider,
    runs: 0,
    costUsd: null,
    costSource: null,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    lastContextUsed: null,
    lastContextSize: null,
  };
}

export function conversationUsage(runs: readonly Run[]): ConversationUsage {
  const byProvider = new Map<string, ProviderChatUsage>();
  for (const run of runs) {
    const entry = byProvider.get(run.provider) ?? emptyProvider(run.provider);
    byProvider.set(run.provider, entry);
    entry.runs += 1;
    const usage = run.usage;
    if (!usage) continue;
    entry.costUsd = addCost(entry.costUsd, usage.costUsd);
    if (usage.costUsd !== null) {
      entry.costSource = mergeCostSource(entry.costSource ?? null, usage.costSource ?? 'reported');
    }
    if (usage.tokens) {
      entry.inputTokens += usage.tokens.input;
      entry.outputTokens += usage.tokens.output;
      entry.totalTokens += usage.tokens.total;
    }
    if (usage.contextSize !== null) {
      entry.lastContextUsed = usage.contextUsed;
      entry.lastContextSize = usage.contextSize;
    }
  }
  const providers = [...byProvider.values()];
  return {
    costUsd: providers.reduce<number | null>((sum, entry) => addCost(sum, entry.costUsd), null),
    costSource: providers.reduce<TotalCostSource | null>(
      (source, entry) => mergeCostSource(source, entry.costSource ?? null),
      null,
    ),
    totalTokens: providers.reduce((sum, entry) => sum + entry.totalTokens, 0),
    byProvider: providers,
  };
}

interface SummaryRow {
  provider: string;
  runs: number;
  cost_usd: number | null;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  recent_runs: number;
  recent_cost_usd: number | null;
  recent_input_tokens: number;
  recent_output_tokens: number;
  recent_total_tokens: number;
  reported: boolean;
  estimated: boolean;
  recent_reported: boolean;
  recent_estimated: boolean;
}

function totalSource(reported: boolean, estimated: boolean): TotalCostSource | null {
  if (reported && estimated) return 'mixed';
  if (estimated) return 'estimated';
  return reported ? 'reported' : null;
}

const RUN_TOTAL = 'COALESCE(r.total_tokens, r.input_tokens + r.output_tokens, 0)';
const RECENT = "r.created_at >= now() - interval '30 days'";
const PRICED = 'r.cost_usd IS NOT NULL';
const ESTIMATED = `${PRICED} AND r.cost_source = 'estimated'`;
const REPORTED = `${PRICED} AND r.cost_source IS DISTINCT FROM 'estimated'`;

export async function usageSummary(db: Queryable, workspaceId: string): Promise<UsageSummary> {
  const { rows } = await db.query<SummaryRow>(
    `SELECT r.provider,
       count(*)::int AS runs,
       sum(r.cost_usd)::float8 AS cost_usd,
       COALESCE(sum(r.input_tokens), 0)::float8 AS input_tokens,
       COALESCE(sum(r.output_tokens), 0)::float8 AS output_tokens,
       sum(${RUN_TOTAL})::float8 AS total_tokens,
       (count(*) FILTER (WHERE ${RECENT}))::int AS recent_runs,
       (sum(r.cost_usd) FILTER (WHERE ${RECENT}))::float8 AS recent_cost_usd,
       COALESCE(sum(r.input_tokens) FILTER (WHERE ${RECENT}), 0)::float8 AS recent_input_tokens,
       COALESCE(sum(r.output_tokens) FILTER (WHERE ${RECENT}), 0)::float8 AS recent_output_tokens,
       COALESCE(sum(${RUN_TOTAL}) FILTER (WHERE ${RECENT}), 0)::float8 AS recent_total_tokens,
       COALESCE(bool_or(${REPORTED}), false) AS reported,
       COALESCE(bool_or(${ESTIMATED}), false) AS estimated,
       COALESCE(bool_or(${REPORTED}) FILTER (WHERE ${RECENT}), false) AS recent_reported,
       COALESCE(bool_or(${ESTIMATED}) FILTER (WHERE ${RECENT}), false) AS recent_estimated
     FROM runs r JOIN conversations c ON c.id = r.conversation_id
     WHERE c.workspace_id = $1
     GROUP BY r.provider
     ORDER BY r.provider`,
    [workspaceId],
  );
  const allTime = rows.map((row): ProviderTotals => ({
    provider: row.provider,
    runs: row.runs,
    costUsd: row.cost_usd,
    costSource: totalSource(row.reported, row.estimated),
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    totalTokens: row.total_tokens,
  }));
  const last30Days = rows
    .filter((row) => row.recent_runs > 0)
    .map((row): ProviderTotals => ({
      provider: row.provider,
      runs: row.recent_runs,
      costUsd: row.recent_cost_usd,
      costSource: totalSource(row.recent_reported, row.recent_estimated),
      inputTokens: row.recent_input_tokens,
      outputTokens: row.recent_output_tokens,
      totalTokens: row.recent_total_tokens,
    }));
  return { last30Days, allTime };
}
