import { providerIssueKind, type ProviderIssue } from '@spark-outpost/contracts';
import type { Queryable } from './db.ts';

const RECENT_FAILURES = 200;

interface FailureRow {
  provider: string;
  error: string;
  at: Date;
}

export async function providerIssues(db: Queryable, workspaceId: string): Promise<ProviderIssue[]> {
  const { rows } = await db.query<FailureRow>(
    `SELECT r.provider, r.error, COALESCE(r.finished_at, r.created_at) AS at
     FROM runs r JOIN conversations c ON c.id = r.conversation_id
     WHERE c.workspace_id = $1 AND r.status = 'failed' AND r.error IS NOT NULL
       AND r.created_at >= now() - interval '24 hours'
       AND NOT EXISTS (
         SELECT 1 FROM runs later JOIN conversations lc ON lc.id = later.conversation_id
         WHERE lc.workspace_id = $1 AND later.provider = r.provider
           AND later.status = 'succeeded' AND later.created_at > r.created_at
       )
     ORDER BY r.created_at DESC
     LIMIT ${RECENT_FAILURES}`,
    [workspaceId],
  );
  const latest = new Map<string, ProviderIssue>();
  for (const row of rows) {
    const kind = providerIssueKind(row.error);
    if (!kind || latest.has(row.provider)) continue;
    latest.set(row.provider, {
      provider: row.provider,
      kind,
      message: row.error,
      at: row.at.toISOString(),
    });
  }
  return [...latest.values()];
}
