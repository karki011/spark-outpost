import {
  providerIdSchema,
  type AgentModeOption,
  type CapabilityOption,
} from '@spark-outpost/contracts';
import { getCapabilities, saveCapabilities } from '../persistence/chat-settings.ts';
import type { Db } from '../persistence/db.ts';
import type { ProviderCapabilityReport, ProviderOutput } from '../providers/provider.ts';
import { cardFor } from '../model-cards/cards.ts';
import { estimateCostUsd } from '../usage/prices.ts';
import type { RunInput } from './run-input.ts';

export async function recordCapabilities(
  db: Db,
  input: RunInput,
  report: ProviderCapabilityReport,
): Promise<void> {
  const provider = providerIdSchema.safeParse(input.provider);
  if (!provider.success || report.models.length === 0) return;
  const known = await getCapabilities(db, input.workspaceId, provider.data);
  await saveCapabilities(db, input.workspaceId, {
    provider: provider.data,
    ...report,
    models: withUnlisted(known?.models ?? [], report),
    efforts: mergeById(known?.efforts ?? [], report.efforts),
    modes: mergeById(known?.modes ?? [], report.modes ?? []),
    defaultMode: report.defaultMode ?? null,
    options: mergeById(known?.options ?? [], report.options ?? []),
  });
}

function withUnlisted(
  known: readonly CapabilityOption[],
  report: ProviderCapabilityReport,
): CapabilityOption[] {
  const missing = (report.access?.unlisted ?? []).filter(
    (id) => !report.models.some((model) => model.id === id),
  );
  return [...known.filter((model) => missing.includes(model.id)), ...report.models];
}

export function mergeById<T extends { id: string }>(
  known: readonly T[],
  reported: readonly T[],
): T[] {
  const reportedById = new Map(reported.map((item) => [item.id, item]));
  const kept = known.map((item) => reportedById.get(item.id) ?? item);
  const keptIds = new Set(kept.map((item) => item.id));
  return [...kept, ...reported.filter((item) => !keptIds.has(item.id))];
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

interface LabelledRun {
  provider: string;
  model: string | null;
  agent_label: string | null;
  model_label: string | null;
}

const LABEL_SEPARATOR = ' · ';

function labelForRanModel(run: LabelledRun, ranModel: string | null): string | null {
  const shown = run.model_label ?? run.model;
  const card = ranModel ? cardFor({ id: ranModel }, run.provider) : null;
  if (!run.agent_label || !shown || !card || card.label === shown) return null;
  const parts = run.agent_label.split(LABEL_SEPARATOR);
  if (!parts.includes(shown)) return null;
  return parts.map((part) => (part === shown ? card.label : part)).join(LABEL_SEPARATOR);
}

export async function recordSessionSettings(
  db: Db,
  runId: string,
  settings: Extract<ProviderOutput, { kind: 'session_settings' }>,
): Promise<void> {
  const { rows } = await db.query<LabelledRun>(
    `UPDATE runs SET used_model = $2, used_effort = $3, used_mode = $4 WHERE id = $1
     RETURNING provider, model, agent_label, route->>'modelLabel' AS model_label`,
    [runId, settings.model, settings.effort, settings.mode],
  );
  const label = rows[0] ? labelForRanModel(rows[0], settings.model) : null;
  if (label) await db.query('UPDATE runs SET agent_label = $2 WHERE id = $1', [runId, label]);
}

export async function recordFollowedInstructions(
  db: Db,
  runId: string,
  files: readonly string[],
): Promise<void> {
  await db.query('UPDATE runs SET followed_instructions = $2 WHERE id = $1', [runId, files]);
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

function tokenEstimate(run: CostInputs): number | null {
  if (run.input_tokens === null || run.output_tokens === null) return null;
  return estimateCostUsd(run.provider, run.model, {
    input: run.input_tokens,
    output: run.output_tokens,
    cachedRead: run.cached_read_tokens,
    cachedWrite: run.cached_write_tokens,
  });
}

export async function recordRunMetrics(
  db: Db,
  runId: string,
  metrics: RunMetrics,
  liveEstimateUsd = 0,
): Promise<void> {
  const { rows } = await db.query<CostInputs>(
    `UPDATE runs SET duration_ms = $2, tool_call_count = $3 WHERE id = $1
     RETURNING provider, COALESCE(used_model, model) AS model, cost_usd, input_tokens,
       output_tokens, cached_read_tokens, cached_write_tokens`,
    [runId, Math.round(metrics.durationMs), metrics.toolCallCount],
  );
  const run = rows[0];
  if (!run || run.cost_usd !== null) return;
  const estimate = tokenEstimate(run) ?? (liveEstimateUsd > 0 ? liveEstimateUsd : null);
  if (estimate === null) return;
  await db.query(
    `UPDATE runs SET cost_usd = $2, cost_source = 'estimated' WHERE id = $1 AND cost_usd IS NULL`,
    [runId, estimate],
  );
}

export async function knownModes(db: Db, input: RunInput): Promise<AgentModeOption[]> {
  const provider = providerIdSchema.safeParse(input.provider);
  if (!provider.success) return [];
  const captured = await getCapabilities(db, input.workspaceId, provider.data).catch(() => null);
  return captured?.modes ?? [];
}
