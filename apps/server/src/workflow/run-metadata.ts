import { providerIdSchema } from '@spark-outpost/contracts';
import { saveCapabilities } from '../persistence/chat-settings.ts';
import type { Db } from '../persistence/db.ts';
import type { ProviderCapabilityReport, ProviderOutput } from '../providers/provider.ts';
import { estimateCostUsd } from '../usage/prices.ts';
import type { RunInput } from './run-input.ts';

export async function recordCapabilities(
  db: Db,
  input: RunInput,
  report: ProviderCapabilityReport,
): Promise<void> {
  const provider = providerIdSchema.safeParse(input.provider);
  if (!provider.success || report.models.length === 0) return;
  await saveCapabilities(db, input.workspaceId, { provider: provider.data, ...report });
}

export async function recordUsage(
  db: Db,
  runId: string,
  usage: Extract<ProviderOutput, { kind: 'usage' }>,
): Promise<void> {
  await db.query(
    `UPDATE runs SET context_used = $2, context_size = $3, cost_usd = COALESCE($4, cost_usd),
       cost_source = CASE WHEN $4::numeric IS NULL THEN cost_source ELSE 'reported' END
     WHERE id = $1`,
    [runId, usage.contextUsed, usage.contextSize, usage.costUsd],
  );
}

export async function recordTokens(
  db: Db,
  runId: string,
  { tokens }: Extract<ProviderOutput, { kind: 'tokens' }>,
): Promise<void> {
  await db.query(
    `UPDATE runs SET input_tokens = $2, output_tokens = $3, total_tokens = $4,
       cached_read_tokens = $5, cached_write_tokens = $6, thought_tokens = $7
     WHERE id = $1`,
    [
      runId,
      tokens.input,
      tokens.output,
      tokens.total,
      tokens.cachedRead,
      tokens.cachedWrite,
      tokens.thought,
    ],
  );
}

export async function recordSessionSettings(
  db: Db,
  runId: string,
  settings: Extract<ProviderOutput, { kind: 'session_settings' }>,
): Promise<void> {
  await db.query(
    'UPDATE runs SET used_model = $2, used_effort = $3, used_mode = $4 WHERE id = $1',
    [runId, settings.model, settings.effort, settings.mode],
  );
}

export interface RunMetrics {
  durationMs: number;
  toolCallCount: number;
}

interface CostInputs {
  provider: string;
  model: string | null;
  cost_usd: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cached_read_tokens: number | null;
  cached_write_tokens: number | null;
}

export async function recordRunMetrics(db: Db, runId: string, metrics: RunMetrics): Promise<void> {
  const { rows } = await db.query<CostInputs>(
    `UPDATE runs SET duration_ms = $2, tool_call_count = $3 WHERE id = $1
     RETURNING provider, COALESCE(used_model, model) AS model, cost_usd, input_tokens,
       output_tokens, cached_read_tokens, cached_write_tokens`,
    [runId, Math.round(metrics.durationMs), metrics.toolCallCount],
  );
  const run = rows[0];
  if (!run || run.cost_usd !== null || run.input_tokens === null || run.output_tokens === null) {
    return;
  }
  const estimate = estimateCostUsd(run.provider, run.model, {
    input: run.input_tokens,
    output: run.output_tokens,
    cachedRead: run.cached_read_tokens,
    cachedWrite: run.cached_write_tokens,
  });
  if (estimate === null) return;
  await db.query(
    `UPDATE runs SET cost_usd = $2, cost_source = 'estimated' WHERE id = $1 AND cost_usd IS NULL`,
    [runId, estimate],
  );
}
