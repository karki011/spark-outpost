import {
  allowFrontierSchema,
  modelStatSchema,
  type AllowFrontier,
  type ModelStat,
  type ProviderId,
} from '@spark-outpost/contracts';
import type { Queryable } from './db.ts';

interface StatRow {
  source: string;
  round: string;
  measured_on: string | Date;
  file: string;
  provider: string;
  model: string;
  agent_model: string;
  effort: string;
  role: string;
  category: string;
  n: number;
  passed: number;
  mean_cost_usd: string;
  cost_source: string;
  mean_wall_ms: number;
  shared_credit: number;
}

function isoDate(value: string | Date): string {
  return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

function toStat(row: StatRow): ModelStat | null {
  const parsed = modelStatSchema.safeParse({
    source: row.source,
    round: row.round,
    measuredOn: isoDate(row.measured_on),
    file: row.file,
    provider: row.provider,
    model: row.model,
    agentModel: row.agent_model,
    effort: row.effort === '' ? null : row.effort,
    role: row.role,
    category: row.category,
    n: row.n,
    passed: row.passed,
    meanCostUsd: Number(row.mean_cost_usd),
    costSource: row.cost_source,
    meanWallMs: row.mean_wall_ms,
    sharedCredit: row.shared_credit,
  });
  return parsed.success ? parsed.data : null;
}

export async function upsertModelStats(
  db: Queryable,
  stats: readonly ModelStat[],
): Promise<number> {
  for (const stat of stats) {
    await db.query(
      `INSERT INTO model_stats (source, round, measured_on, file, provider, model, agent_model,
         effort, role, category, n, passed, mean_cost_usd, cost_source, mean_wall_ms, shared_credit)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       ON CONFLICT (source, round, provider, agent_model, effort, role, category) DO UPDATE SET
         measured_on = EXCLUDED.measured_on, file = EXCLUDED.file, model = EXCLUDED.model,
         n = EXCLUDED.n, passed = EXCLUDED.passed, mean_cost_usd = EXCLUDED.mean_cost_usd,
         cost_source = EXCLUDED.cost_source, mean_wall_ms = EXCLUDED.mean_wall_ms,
         shared_credit = EXCLUDED.shared_credit, recorded_at = now()`,
      [
        stat.source,
        stat.round,
        stat.measuredOn,
        stat.file,
        stat.provider,
        stat.model,
        stat.agentModel,
        stat.effort ?? '',
        stat.role,
        stat.category,
        stat.n,
        stat.passed,
        stat.meanCostUsd,
        stat.costSource,
        stat.meanWallMs,
        stat.sharedCredit,
      ],
    );
  }
  return stats.length;
}

export async function replaceRound(
  db: Queryable,
  source: ModelStat['source'],
  round: string,
  stats: readonly ModelStat[],
): Promise<number> {
  await db.query('DELETE FROM model_stats WHERE source = $1 AND round = $2', [source, round]);
  return upsertModelStats(db, stats);
}

export async function listModelStats(db: Queryable): Promise<ModelStat[]> {
  const { rows } = await db.query<StatRow>(
    'SELECT * FROM model_stats ORDER BY measured_on DESC, provider, model, role, category',
  );
  return rows.flatMap((row) => toStat(row) ?? []);
}

export async function allowFrontier(db: Queryable, workspaceId: string): Promise<AllowFrontier> {
  const { rows } = await db.query<{ allow_frontier: unknown }>(
    'SELECT allow_frontier FROM profiles WHERE workspace_id = $1',
    [workspaceId],
  );
  const parsed = allowFrontierSchema.safeParse(rows[0]?.allow_frontier ?? {});
  return parsed.success ? parsed.data : {};
}

export async function setAllowFrontier(
  db: Queryable,
  workspaceId: string,
  provider: ProviderId,
  allowed: boolean,
): Promise<AllowFrontier> {
  await db.query(
    `INSERT INTO profiles (workspace_id, allow_frontier) VALUES ($1, jsonb_build_object($2::text, $3::boolean))
     ON CONFLICT (workspace_id) DO UPDATE
       SET allow_frontier = profiles.allow_frontier || jsonb_build_object($2::text, $3::boolean),
           updated_at = now()`,
    [workspaceId, provider, allowed],
  );
  return allowFrontier(db, workspaceId);
}
