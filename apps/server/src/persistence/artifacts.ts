import {
  planBodySchema,
  type ArtifactKind,
  type CheckBody,
  type PlanBody,
  type PlanVersion,
  type ReviewBody,
  type ShortcutsBody,
} from '@spark-outpost/contracts';
import type { StoredPlan } from '../tasks/plan-versions.ts';
import type { DbClient, Queryable } from './db.ts';

export interface ArtifactWrite {
  taskId: string;
  kind: ArtifactKind;
  version: number;
  body: PlanBody | ReviewBody | CheckBody | ShortcutsBody;
  overwrite: boolean;
  supersedesPrevious: boolean;
  sourceRunId?: string;
}

interface PlanRow {
  version: number;
  body: unknown;
  source_run_id: string | null;
  superseded_by: number | null;
  created_at: Date;
  used_by: string[];
}

export async function writeArtifact(
  client: DbClient,
  runId: string,
  write: ArtifactWrite,
): Promise<void> {
  const body = JSON.stringify(write.body);
  const sourceRunId = write.sourceRunId ?? runId;
  if (write.overwrite) {
    await client.query(
      `UPDATE run_artifacts SET body = $4, source_run_id = $5, created_at = now()
       WHERE task_id = $1 AND kind = $2 AND version = $3`,
      [write.taskId, write.kind, write.version, body, sourceRunId],
    );
  } else {
    await client.query(
      `INSERT INTO run_artifacts (task_id, kind, version, body, source_run_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [write.taskId, write.kind, write.version, body, sourceRunId],
    );
  }
  if (write.supersedesPrevious) {
    await client.query(
      `UPDATE run_artifacts SET superseded_by = $3
       WHERE task_id = $1 AND kind = $2 AND version = $3 - 1`,
      [write.taskId, write.kind, write.version],
    );
  }
  if (write.kind === 'plan') {
    await client.query('UPDATE runs SET plan_version = $2 WHERE id = $1', [
      sourceRunId,
      write.version,
    ]);
  }
}

type LatestPlan = StoredPlan & { sourceRunId: string | null };

export async function latestPlans(
  db: Queryable,
  taskIds: readonly string[],
): Promise<Map<string, LatestPlan>> {
  const { rows } = await db.query<{
    task_id: string;
    version: number;
    body: unknown;
    source_run_id: string | null;
  }>(
    `SELECT DISTINCT ON (task_id) task_id, version, body, source_run_id FROM run_artifacts
     WHERE task_id = ANY($1::uuid[]) AND kind = 'plan'
     ORDER BY task_id, version DESC`,
    [taskIds],
  );
  return new Map(
    rows.map((row) => {
      const body = planBodySchema.safeParse(row.body);
      return [
        row.task_id,
        {
          version: row.version,
          entries: body.success ? body.data.entries : [],
          sourceRunId: row.source_run_id,
        },
      ];
    }),
  );
}

export async function latestPlan(db: Queryable, taskId: string): Promise<LatestPlan | null> {
  return (await latestPlans(db, [taskId])).get(taskId) ?? null;
}

export async function planVersions(db: Queryable, taskId: string): Promise<PlanVersion[]> {
  const { rows } = await db.query<PlanRow>(
    `SELECT a.version, a.body, a.source_run_id, a.superseded_by, a.created_at,
       ARRAY(
         SELECT r.id::text FROM runs r
         WHERE r.task_id = a.task_id AND r.plan_version = a.version ORDER BY r.created_at
       ) AS used_by
     FROM run_artifacts a WHERE a.task_id = $1 AND a.kind = 'plan' ORDER BY a.version`,
    [taskId],
  );
  return rows.flatMap((row) => {
    const body = planBodySchema.safeParse(row.body);
    if (!body.success) return [];
    return [
      {
        version: row.version,
        body: body.data,
        sourceRunId: row.source_run_id,
        supersededBy: row.superseded_by,
        createdAt: row.created_at.toISOString(),
        usedBy: row.used_by,
      },
    ];
  });
}
