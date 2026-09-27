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

interface Pick {
  provider?: string;
  model?: string | null;
  modelLabel?: string | null;
}

interface Variant {
  status?: string;
  choice?: string | null;
  confidence?: number | null;
  latencyMs?: number | null;
  tokens?: number | null;
  costUsd?: number | null;
  selection?: { basis: string; tier: string | null; routeProbability: number } | null;
  pick?: Pick;
}

function pickName(pick: unknown): string | null {
  const value = pick as Pick | null | undefined;
  if (!value) return null;
  return value.modelLabel ?? value.model ?? value.provider ?? null;
}

function variantLabel(raw: unknown) {
  const variant = raw as Variant | null | undefined;
  if (!variant) return null;
  return {
    status: variant.status ?? null,
    pick: pickName(variant.pick),
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

function stageOneOrder(raw: unknown): string[] {
  const stage = raw as { probabilities?: [string, number][] } | null;
  return (stage?.probabilities ?? []).map(([path]) => path);
}

export function toLabel(row: RoutingLabelRow) {
  const changed = row.changed_files ?? [];
  const known = row.changed_files !== null;
  const rule = row.rule_route as { pick?: Pick; rule?: string } | null;
  return {
    runId: row.run_id,
    taskId: row.task_id,
    createdAt: row.created_at.toISOString(),
    status: row.status,
    request: row.request,
    policyVersion: row.policy_version,
    policy: row.policy,
    candidates: row.candidates,
    rule: { pick: pickName(rule?.pick), rule: rule?.rule ?? null },
    builder: pickName(row.builder_route),
    tierPick: pickName(row.tier_pick),
    codePick: pickName(row.code_pick),
    jevText: variantLabel(row.jev_text),
    jevEvidence: variantLabel(row.jev_evidence),
    textDistribution: (row.jev_text as { probabilities?: unknown } | null)?.probabilities ?? null,
    evidenceDistribution:
      (row.jev_evidence as { probabilities?: unknown } | null)?.probabilities ?? null,
    scan: { status: row.scan_status, ms: row.scan_ms },
    predictedFiles: row.predicted_files ?? [],
    changedFiles: known ? changed : null,
    files: known
      ? {
          scan: atK(row.scan_files ?? [], changed),
          stageOne: atK(stageOneOrder(row.rank_stage_one), changed),
          predicted: atK(row.predicted_files ?? [], changed),
        }
      : null,
    rankStageOne: row.rank_stage_one,
    rankStageTwo: row.rank_stage_two,
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
