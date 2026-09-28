import type { ProjectTrust } from '@spark-outpost/contracts';
import { withTransaction, type Db, type Queryable } from '../persistence/db.ts';
import { classifyAllowRule } from './allow-rules.ts';
import type { RepoScan } from './discovery.ts';
import { redirectsFingerprint } from './redirects.ts';
import { audit } from './store.ts';
import { executableItems, trustFingerprint, type ExecutableItem, type TrustRow } from './trust.ts';

interface TrustDbRow {
  project_id: string;
  trusted: boolean;
  fingerprint: string | null;
  snapshot: ExecutableItem[];
  redirects_fingerprint: string | null;
  decided_at: Date;
}

function toTrust(row: TrustDbRow): TrustRow {
  return {
    trusted: row.trusted,
    fingerprint: row.fingerprint,
    snapshot: row.snapshot,
    redirectsFingerprint: row.redirects_fingerprint,
    decidedAt: row.decided_at.toISOString(),
  };
}

export async function trustFor(
  db: Queryable,
  projectIds: readonly string[],
): Promise<Map<string, TrustRow>> {
  const { rows } = await db.query<TrustDbRow>(
    'SELECT * FROM project_trust WHERE project_id = ANY($1::uuid[])',
    [projectIds],
  );
  return new Map(rows.map((row) => [row.project_id, toTrust(row)]));
}

export async function listProjectTrust(
  db: Queryable,
  workspaceId: string,
): Promise<ProjectTrust[]> {
  const { rows } = await db.query<TrustDbRow>(
    `SELECT t.* FROM project_trust t JOIN projects p ON p.id = t.project_id
      WHERE p.workspace_id = $1 ORDER BY t.decided_at`,
    [workspaceId],
  );
  return rows.map((row) => ({
    projectId: row.project_id,
    trusted: row.trusted,
    decidedAt: row.decided_at.toISOString(),
    redirectsConfirmed: row.trusted && row.redirects_fingerprint !== null,
  }));
}

function grantDetail(scan: RepoScan, fingerprint: string) {
  const verdicts = scan.allowRules.map((entry) => classifyAllowRule(entry.rule));
  return {
    fingerprint,
    hooks: executableItems(scan)
      .filter((item) => item.kind === 'hook')
      .map((item) => item.label),
    mcpServers: scan.mcpServers.map((server) => ({
      name: server.name,
      fingerprint: server.fingerprint,
    })),
    allowRules: verdicts.filter((verdict) => verdict.applied).map((verdict) => verdict.rule),
    droppedAllowRules: verdicts.filter((verdict) => !verdict.applied),
  };
}

export async function grantTrust(
  db: Db,
  workspaceId: string,
  projectId: string,
  scan: RepoScan,
): Promise<void> {
  const items = executableItems(scan);
  const fingerprint = trustFingerprint(items);
  await withTransaction(db, async (client) => {
    await client.query(
      `INSERT INTO project_trust (project_id, trusted, fingerprint, snapshot, decided_at)
       VALUES ($1, true, $2, $3, now())
       ON CONFLICT (project_id) DO UPDATE SET
         trusted = true, fingerprint = EXCLUDED.fingerprint,
         snapshot = EXCLUDED.snapshot, decided_at = now()`,
      [projectId, fingerprint, JSON.stringify(items)],
    );
    await audit(
      client,
      workspaceId,
      projectId,
      'trust',
      true,
      null,
      grantDetail(scan, fingerprint),
    );
  });
}

export async function withdrawTrust(db: Db, workspaceId: string, projectId: string): Promise<void> {
  await withTransaction(db, async (client) => {
    const previous = (await trustFor(client, [projectId])).get(projectId) ?? null;
    await client.query(
      `INSERT INTO project_trust (project_id, trusted, fingerprint, redirects_fingerprint, decided_at)
       VALUES ($1, false, NULL, NULL, now())
       ON CONFLICT (project_id) DO UPDATE SET
         trusted = false, fingerprint = NULL, snapshot = '[]'::jsonb,
         redirects_fingerprint = NULL, decided_at = now()`,
      [projectId],
    );
    await audit(client, workspaceId, projectId, 'trust', false, null, {
      fingerprint: previous?.fingerprint ?? null,
      reason: previous?.trusted ? 'revoked' : 'declined',
    });
  });
}

export async function setRedirects(
  db: Db,
  workspaceId: string,
  projectId: string,
  scan: RepoScan,
  confirmed: boolean,
): Promise<void> {
  const fingerprint = confirmed ? redirectsFingerprint(scan.redirects) : null;
  await withTransaction(db, async (client) => {
    await client.query(
      'UPDATE project_trust SET redirects_fingerprint = $2 WHERE project_id = $1',
      [projectId, fingerprint],
    );
    await audit(client, workspaceId, projectId, 'redirects', confirmed, null, {
      fingerprint,
      settings: scan.redirects.map((setting) => ({
        kind: setting.kind,
        name: setting.name,
        source: setting.source,
      })),
    });
  });
}
