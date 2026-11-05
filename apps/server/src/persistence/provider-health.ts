import { providerIssueKind, type ProviderIssue } from '@spark-outpost/contracts';
import type { Queryable } from './db.ts';

const RECENT_FAILURES = 200;

interface FailureRow {
  provider: string;
  error: string;
  at: Date;
  checked_at: Date | null;
}

function signedInSince(row: FailureRow): boolean {
  return row.checked_at !== null && row.checked_at > row.at;
}

export async function providerIssues(db: Queryable, workspaceId: string): Promise<ProviderIssue[]> {
  const { rows } = await db.query<FailureRow>(
    `SELECT r.provider, r.error, COALESCE(r.finished_at, r.created_at) AS at,
       GREATEST(pc.verified_at, CASE WHEN pc.last_test_ok THEN pc.last_test_at END) AS checked_at
     FROM runs r JOIN conversations c ON c.id = r.conversation_id
     LEFT JOIN provider_connections pc
       ON pc.workspace_id = c.workspace_id AND pc.provider = r.provider
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
  const seen = new Set<string>();
  const latest = new Map<string, ProviderIssue>();
  for (const row of rows) {
    const kind = providerIssueKind(row.error);
    if (!kind || seen.has(row.provider)) continue;
    seen.add(row.provider);
    if (kind === 'auth' && signedInSince(row)) continue;
    latest.set(row.provider, {
      provider: row.provider,
      kind,
      message: row.error,
      at: row.at.toISOString(),
    });
  }
  return [...latest.values()];
}
