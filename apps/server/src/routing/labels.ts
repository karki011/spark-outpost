import { z } from 'zod';
import { agentPickSchema } from '@spark-outpost/contracts';
import type { RoutingLabelRow } from '../persistence/routing-labels.ts';

export const TOP_K = 5;

export interface AtK {
  hits: number;
  precision: number | null;
  recall: number | null;
}

export function atK(predicted: readonly string[], changed: readonly string[], k = TOP_K): AtK {
  const top = predicted.slice(0, k);
  const wanted = new Set(changed);
  const hits = top.filter((path) => wanted.has(path)).length;
  return {
    hits,
    precision: top.length > 0 ? hits / top.length : null,
    recall: wanted.size > 0 ? hits / wanted.size : null,
  };
}

const pickShape = agentPickSchema.shape;
const pickFieldsSchema = z.object({
  provider: pickShape.provider.optional().catch(undefined),
  model: pickShape.model.optional().catch(undefined),
  modelLabel: pickShape.modelLabel.optional().catch(undefined),
});
const optionalPick = pickFieldsSchema.nullable().optional().catch(undefined);
const optionalNumber = z.number().nullable().optional().catch(undefined);

const variantSchema = z.object({
  status: z.string().optional().catch(undefined),
  choice: z.string().nullable().optional().catch(undefined),
  confidence: optionalNumber,
  latencyMs: optionalNumber,
  tokens: optionalNumber,
  costUsd: optionalNumber,
  selection: z
    .object({ basis: z.string(), tier: z.string().nullable(), routeProbability: z.number() })
    .nullable()
    .optional()
    .catch(undefined),
  pick: optionalPick,
  raisedTo: optionalPick,
});

const ruleRouteSchema = z.object({
  pick: optionalPick,
  rule: z.string().optional().catch(undefined),
});

type PickFields = z.infer<typeof pickFieldsSchema>;

function parsed<T>(schema: z.ZodType<T>, value: unknown): T | null {
  const result = schema.safeParse(value);
  return result.success ? result.data : null;
}

function nameOf(pick: PickFields | null | undefined): string | null {
  if (!pick) return null;
  return pick.modelLabel ?? pick.model ?? pick.provider ?? null;
}

function pickName(raw: unknown): string | null {
  return nameOf(parsed(pickFieldsSchema, raw));
}

function variantLabel(raw: unknown) {
  const variant = parsed(variantSchema, raw);
  if (!variant) return null;
  return {
    status: variant.status ?? null,
    pick: nameOf(variant.pick),
    runs: nameOf(variant.raisedTo ?? variant.pick),
    choice: variant.choice ?? null,
    confidence: variant.confidence ?? null,
    basis: variant.selection?.basis ?? null,
    tier: variant.selection?.tier ?? null,
    routeProbability: variant.selection?.routeProbability ?? null,
    latencyMs: variant.latencyMs ?? null,
    tokens: variant.tokens ?? null,
    costUsd: variant.costUsd ?? null,
  };
}

type RankColumns = Pick<RoutingLabelRow, 'scan_files' | 'predicted_files'>;

export function filesAtK(row: RankColumns, changed: readonly string[]) {
  return {
    scan: atK(row.scan_files ?? [], changed),
    predicted: atK(row.predicted_files ?? [], changed),
  };
}

export function toLabel(row: RoutingLabelRow) {
  const changed = row.changed_files ?? [];
  const known = row.changed_files !== null;
  const rule = parsed(ruleRouteSchema, row.rule_route);
  return {
    runId: row.run_id,
    taskId: row.task_id,
    createdAt: row.created_at.toISOString(),
    status: row.status,
    request: row.request,
    policyVersion: row.policy_version,
    policy: row.policy,
    candidates: row.candidates,
    rule: { pick: nameOf(rule?.pick), rule: rule?.rule ?? null },
    builder: pickName(row.builder_route),
    tierPick: pickName(row.tier_pick),
    codePick: pickName(row.code_pick),
    jevText: variantLabel(row.jev_text),
    jevEvidence: variantLabel(row.jev_evidence),
    textDistribution: (row.jev_text as { probabilities?: unknown } | null)?.probabilities ?? null,
    evidenceDistribution:
      (row.jev_evidence as { probabilities?: unknown } | null)?.probabilities ?? null,
    scan: { status: row.scan_status, ms: row.scan_ms },
    scanFiles: row.scan_files ?? [],
    predictedFiles: row.predicted_files ?? [],
    changedFiles: known ? changed : null,
    files: known ? filesAtK(row, changed) : null,
    rankJev: row.rank_jev,
    checks: row.checks,
    verify: row.verify,
    critic: row.critic,
    escalated: row.escalated ?? false,
    keepRevert: row.keep_revert,
    thumbs: row.thumbs,
    jevTokens: row.jev_tokens,
    jevCostUsd: Number(row.jev_cost_usd),
  };
}

export type RoutingLabel = ReturnType<typeof toLabel>;
