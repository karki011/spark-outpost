import {
  adviceSummarySchema,
  PERMISSION_DO,
  providerIdSchema,
  type AdviceBody,
  type AdviceSummary,
  type AdvisorUsage,
  type CapabilityOption,
  type ModelRouting,
  type ProviderId,
  type ProviderModel,
} from '@spark-outpost/contracts';
import type { AdvisorCandidate } from '../advisor/advice.ts';
import { advisorEntry, catalogEntry, isSelectablePermission } from '../providers/catalog.ts';
import { reportedEfforts } from '../providers/efforts.ts';
import { listModelStats } from './model-stats.ts';
import type { Queryable } from './db.ts';

export async function insertAdvice(db: Queryable, runId: string, body: AdviceBody): Promise<void> {
  await db.query(
    `INSERT INTO run_advice (run_id, purpose, jev_status, jev_input_tokens, jev_cost_usd, body,
       policy_version)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (run_id) WHERE purpose = 'intake' DO NOTHING`,
    [
      runId,
      body.purpose,
      body.jevStatus,
      body.usage?.inputTokens ?? null,
      body.usage?.costUsd ?? null,
      JSON.stringify(body),
      body.policyVersion ?? null,
    ],
  );
}

export async function runAdvice(db: Queryable, runId: string): Promise<AdviceBody | null> {
  const { rows } = await db.query<{ body: AdviceBody }>(
    `SELECT body FROM run_advice WHERE run_id = $1 AND purpose = 'intake'`,
    [runId],
  );
  return rows[0]?.body ?? null;
}

interface UsageRow {
  calls: number;
  input_tokens: number;
  cost_usd: number;
}

const USAGE_COLUMNS = `
  count(*) FILTER (WHERE a.jev_status NOT IN ('not_connected', 'not_asked'))::int AS calls,
  COALESCE(sum(a.jev_input_tokens), 0)::int AS input_tokens,
  COALESCE(sum(a.jev_cost_usd), 0)::float8 AS cost_usd`;

function toUsage(row: UsageRow | undefined): AdvisorUsage[] {
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
  const usage = await db.query<UsageRow>(
    `SELECT ${USAGE_COLUMNS} FROM run_advice a JOIN runs r ON r.id = a.run_id
     WHERE r.conversation_id = $1`,
    [conversationId],
  );
  return { byRun, usage: toUsage(usage.rows[0]) };
}

export async function advisorUsageForRuns(
  db: Queryable,
  runIds: readonly string[],
): Promise<AdvisorUsage[]> {
  const { rows } = await db.query<UsageRow>(
    `SELECT ${USAGE_COLUMNS} FROM run_advice a WHERE a.run_id = ANY($1::uuid[])`,
    [runIds],
  );
  return toUsage(rows[0]);
}

export async function advisorUsageSummary(
  db: Queryable,
  workspaceId: string,
): Promise<{ last30Days: AdvisorUsage[]; allTime: AdvisorUsage[] }> {
  const query = (recentOnly: boolean) =>
    db.query<UsageRow>(
      `SELECT ${USAGE_COLUMNS} FROM run_advice a
       JOIN runs r ON r.id = a.run_id JOIN conversations c ON c.id = r.conversation_id
       WHERE c.workspace_id = $1
         AND ($2::boolean IS FALSE OR a.created_at >= now() - interval '30 days')`,
      [workspaceId, recentOnly],
    );
  const [recent, all] = await Promise.all([query(true), query(false)]);
  return { last30Days: toUsage(recent.rows[0]), allTime: toUsage(all.rows[0]) };
}

interface CandidateRow {
  provider: string;
  models: ProviderModel[];
  capability_models: CapabilityOption[] | null;
  capability_efforts: CapabilityOption[] | null;
  effort: string | null;
}

function toCandidate(row: CandidateRow & { provider: ProviderId }): AdvisorCandidate {
  const entry = catalogEntry(row.provider);
  const reportedModels = row.capability_models ?? [];
  const models =
    reportedModels.length > 0
      ? reportedModels
      : row.models.map((model) => ({ ...model, description: null }));
  const efforts = reportedEfforts(row.provider, row.capability_efforts);
  return {
    provider: row.provider,
    name: entry.name,
    models: models.map(({ id, label, description }) => ({ id, label, description })),
    efforts: efforts.map(({ id, label, description }) => ({ id, label, description })),
    doAvailable: isSelectablePermission(entry, PERMISSION_DO),
  };
}

export interface IntakeContext {
  jevModel: string | null;
  routing: ModelRouting;
  candidates: AdvisorCandidate[];
  defaultEfforts: Readonly<Record<string, string>>;
}

export async function loadIntakeContext(
  db: Queryable,
  workspaceId: string,
  conversationId: string,
): Promise<IntakeContext> {
  const [candidates, jev, conversation, stats] = await Promise.all([
    db.query<CandidateRow>(
      `SELECT pc.provider, pc.models, pc.effort, cap.models AS capability_models,
         cap.efforts AS capability_efforts
       FROM provider_connections pc
       LEFT JOIN provider_capabilities cap
         ON cap.workspace_id = pc.workspace_id AND cap.provider = pc.provider
       WHERE pc.workspace_id = $1 AND pc.disconnected_at IS NULL ORDER BY pc.provider`,
      [workspaceId],
    ),
    db.query<{ model: string | null }>(
      `SELECT model FROM advisor_connections
       WHERE workspace_id = $1 AND advisor = 'jev' AND disconnected_at IS NULL`,
      [workspaceId],
    ),
    db.query<{ model_routing: ModelRouting }>(
      'SELECT model_routing FROM conversations WHERE id = $1',
      [conversationId],
    ),
    listModelStats(db),
  ]);
  const jevRow = jev.rows[0];
  const known = candidates.rows.flatMap((row) => {
    const provider = providerIdSchema.safeParse(row.provider);
    return provider.success ? [{ ...row, provider: provider.data }] : [];
  });
  return {
    jevModel: jevRow ? (jevRow.model ?? advisorEntry('jev').defaultModel) : null,
    routing: conversation.rows[0]?.model_routing ?? 'pinned',
    candidates: known.map((row) => ({ ...toCandidate(row), stats })),
    defaultEfforts: Object.fromEntries(
      known.flatMap((row) => (row.effort ? [[row.provider, row.effort]] : [])),
    ),
  };
}
