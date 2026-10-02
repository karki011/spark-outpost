import { z } from 'zod';
import {
  providerIdSchema,
  spendRangeSchema,
  type ProviderCardsView,
} from '@spark-outpost/contracts';
import { loadModelCards } from '../../model-cards/load.ts';
import type { Queryable } from '../../persistence/db.ts';
import { spendSummary } from '../../persistence/spend.ts';
import { localTimeZone, nowOf } from '../deps.ts';
import { round } from '../format.ts';
import { limitInput, sparkTool, SparkToolError, type SparkToolContext } from '../tool.ts';
import { reportedModel } from '../../providers/reported-model.ts';

interface SpendRow {
  provider: string;
  model: string | null;
  chat_id: string;
  chat_title: string;
  runs: number;
  cost_usd: number | null;
  tokens: number;
}

async function spendRows(db: Queryable, workspaceId: string, since: string): Promise<SpendRow[]> {
  const { rows } = await db.query<SpendRow>(
    `SELECT r.provider, COALESCE(r.used_model, r.model) AS model, c.id AS chat_id,
       c.title AS chat_title, count(*)::int AS runs, sum(r.cost_usd)::float8 AS cost_usd,
       COALESCE(sum(COALESCE(r.total_tokens, r.input_tokens + r.output_tokens, 0)), 0)::float8
         AS tokens
     FROM runs r JOIN conversations c ON c.id = r.conversation_id
     WHERE c.workspace_id = $1 AND r.created_at >= $2
     GROUP BY 1, 2, 3, 4`,
    [workspaceId, since],
  );
  return rows;
}

interface Bucket {
  runs: number;
  costUsd: number;
  tokens: number;
}

function totalBy<K extends string>(rows: readonly SpendRow[], key: (row: SpendRow) => K) {
  const buckets = new Map<K, Bucket>();
  for (const row of rows) {
    const bucket = buckets.get(key(row)) ?? { runs: 0, costUsd: 0, tokens: 0 };
    bucket.runs += row.runs;
    bucket.costUsd += row.cost_usd ?? 0;
    bucket.tokens += row.tokens;
    buckets.set(key(row), bucket);
  }
  return [...buckets]
    .map(([name, bucket]) => ({ name, ...bucket, costUsd: round(bucket.costUsd) }))
    .sort((a, b) => (b.costUsd ?? 0) - (a.costUsd ?? 0));
}

function spentOn(row: SpendRow): string {
  const { model, modelLabel } = reportedModel(row.provider, row.model);
  return modelLabel ?? model ?? 'default';
}

async function spend(
  { deps, scope }: SparkToolContext,
  range: z.infer<typeof spendRangeSchema>,
  limit: number,
) {
  const summary = await spendSummary(deps.db, scope.workspaceId, range, localTimeZone(deps));
  const rows = await spendRows(deps.db, scope.workspaceId, summary.since);
  const titles = new Map(rows.map((row) => [row.chat_id, row.chat_title]));
  return {
    range,
    since: summary.since,
    runs: summary.runs,
    costUsd: round(summary.costUsd),
    costSource: summary.costSource,
    totalTokens: summary.totalTokens,
    byProvider: summary.byProvider.map((row) => ({
      provider: row.provider,
      runs: row.runs,
      costUsd: round(row.costUsd),
      costSource: row.costSource,
      tokens: row.totalTokens,
    })),
    byModel: totalBy(rows, (row) => `${row.provider} · ${spentOn(row)}`).slice(0, limit),
    byChat: totalBy(rows, (row) => row.chat_id)
      .slice(0, limit)
      .map(({ name, ...bucket }) => ({ id: name, title: titles.get(name) ?? '', ...bucket })),
    note: 'Jev appears under byProvider only. For more days, trends or cost per task use spark_analytics report=spend.',
  };
}

function modelLine(view: ProviderCardsView['models'][number]) {
  const { card } = view;
  return {
    id: card.id,
    label: card.label,
    tier: card.tier,
    offered: view.offered,
    ...(view.isDefault ? { default: true } : {}),
    pricePerMillion: card.price
      ? { input: card.price.inputPerMillion, output: card.price.outputPerMillion }
      : null,
    contextTokens: card.contextTokens,
    speed: card.speed,
    efforts: card.reasoning.efforts,
    strengths: card.strengths,
    weakSpots: card.weakSpots,
    blurb: card.blurb,
    ...(view.staleness.retiring || view.staleness.retired
      ? { retiring: card.retiresNotBefore ?? true }
      : {}),
    measured: view.stats.map((stat) => ({
      role: stat.role,
      category: stat.category,
      passed: `${stat.passed}/${stat.n}`,
      meanCostUsd: round(stat.meanCostUsd),
      meanSeconds: Math.round(stat.meanWallMs / 1000),
    })),
  };
}

async function models(
  { deps, scope }: SparkToolContext,
  args: { provider?: string | undefined; model?: string | undefined },
) {
  const cards = await loadModelCards(deps.db, scope.workspaceId, nowOf(deps));
  const wanted = args.model?.trim().toLowerCase();
  const providers = cards.providers
    .filter((entry) => !args.provider || entry.provider.provider === args.provider)
    .map((entry) => ({
      provider: entry.provider.label,
      id: entry.provider.provider,
      connected: entry.connected,
      everydayModel: entry.provider.everydayModel,
      costSource: entry.provider.costSource,
      models: entry.models
        .filter(
          (view) =>
            !wanted ||
            view.card.id.toLowerCase().includes(wanted) ||
            view.card.label.toLowerCase().includes(wanted),
        )
        .map(modelLine),
      ...(entry.uncardedModels.length > 0 ? { withoutCards: entry.uncardedModels } : {}),
    }))
    .filter((entry) => !wanted || entry.models.length > 0);
  if (providers.length === 0) throw new SparkToolError('No model card matches that.');
  return { checkedAt: cards.checkedAt, providers };
}

export const usageTools = [
  sparkTool({
    name: 'spark_spend',
    privateData: true,
    title: 'Spend',
    description:
      "What Spark has spent today or this week (the user's time zone), as on Home: total cost, runs and tokens, then split by provider (including Jev), by model and by chat, most expensive first.",
    input: {
      range: spendRangeSchema.default('today'),
      limit: limitInput(10, 50),
    },
    run: (args, context) => spend(context, args.range, args.limit),
  }),
  sparkTool({
    name: 'spark_models',
    title: 'Model cards',
    description:
      "Spark's model cards per provider: each model's tier, price per million tokens, context size, speed, reasoning efforts, strengths, weak spots, whether the connected agent offers it or uses it by default, retirement, and Spark's measured pass rates and cost by role and task type. Filter by provider or a model name.",
    input: {
      provider: providerIdSchema.optional(),
      model: z.string().max(100).optional().describe('Part of a model id or name, like opus.'),
    },
    run: (args, context) => models(context, args),
  }),
];
