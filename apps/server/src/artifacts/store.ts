import type { ArtifactPage, ArtifactPageKind } from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';

export interface StoredVersion {
  artifactId: string;
  conversationId: string;
  kind: ArtifactPageKind;
  version: number;
  title: string;
  bytes: number;
  sha256: string;
  viewKey: string;
  published: boolean;
}

interface VersionRow {
  artifact_id: string;
  conversation_id: string;
  kind: ArtifactPageKind;
  version: number;
  title: string;
  bytes: number;
  sha256: string;
  view_key: string;
  published_at: Date | null;
}

const VERSION_COLUMNS = `v.artifact_id, a.conversation_id, a.kind, v.version, v.title, v.bytes,
  v.sha256, v.view_key, v.published_at`;

function toVersion(row: VersionRow): StoredVersion {
  return {
    artifactId: row.artifact_id,
    conversationId: row.conversation_id,
    kind: row.kind,
    version: row.version,
    title: row.title,
    bytes: row.bytes,
    sha256: row.sha256,
    viewKey: row.view_key,
    published: row.published_at !== null,
  };
}

export interface NewVersion {
  artifactId: string;
  conversationId: string;
  kind: ArtifactPageKind;
  version: number;
  title: string;
  bytes: number;
  sha256: string;
  viewKey: string;
  runId: string | null;
}

export async function insertVersion(db: Queryable, version: NewVersion): Promise<void> {
  if (version.version === 1) {
    await db.query('INSERT INTO artifact_pages (id, conversation_id, kind) VALUES ($1, $2, $3)', [
      version.artifactId,
      version.conversationId,
      version.kind,
    ]);
  }
  await db.query(
    `INSERT INTO artifact_page_versions
       (artifact_id, version, title, bytes, sha256, view_key, run_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      version.artifactId,
      version.version,
      version.title,
      version.bytes,
      version.sha256,
      version.viewKey,
      version.runId,
    ],
  );
}

export async function publishVersion(
  db: Queryable,
  artifactId: string,
  version: number,
  runId: string | null,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE artifact_page_versions SET published_at = now(), run_id = COALESCE($3, run_id)
     WHERE artifact_id = $1 AND version = $2 AND published_at IS NULL`,
    [artifactId, version, runId],
  );
  return (rowCount ?? 0) > 0;
}

export async function findVersion(
  db: Queryable,
  artifactId: string,
  version: number | null,
): Promise<StoredVersion | null> {
  const { rows } = await db.query<VersionRow>(
    `SELECT ${VERSION_COLUMNS}
     FROM artifact_page_versions v JOIN artifact_pages a ON a.id = v.artifact_id
     WHERE v.artifact_id = $1 AND ($2::int IS NULL OR v.version = $2)
       AND ($2::int IS NOT NULL OR v.published_at IS NOT NULL)
     ORDER BY v.version DESC LIMIT 1`,
    [artifactId, version],
  );
  return rows[0] ? toVersion(rows[0]) : null;
}

export async function versionByViewKey(db: Queryable, key: string): Promise<StoredVersion | null> {
  const { rows } = await db.query<VersionRow>(
    `SELECT ${VERSION_COLUMNS}
     FROM artifact_page_versions v JOIN artifact_pages a ON a.id = v.artifact_id
     WHERE v.view_key = $1 AND v.published_at IS NOT NULL`,
    [key],
  );
  return rows[0] ? toVersion(rows[0]) : null;
}

export async function lastVersionNumber(db: Queryable, artifactId: string): Promise<number> {
  const { rows } = await db.query<{ version: number | null }>(
    'SELECT max(version) AS version FROM artifact_page_versions WHERE artifact_id = $1',
    [artifactId],
  );
  return rows[0]?.version ?? 0;
}

export async function artifactInChat(
  db: Queryable,
  artifactId: string,
  conversationId: string,
): Promise<{ kind: ArtifactPageKind } | null> {
  const { rows } = await db.query<{ kind: ArtifactPageKind }>(
    'SELECT kind FROM artifact_pages WHERE id = $1 AND conversation_id = $2',
    [artifactId, conversationId],
  );
  return rows[0] ?? null;
}

export async function artifactWorkspace(db: Queryable, artifactId: string): Promise<string | null> {
  const { rows } = await db.query<{ workspace_id: string }>(
    `SELECT c.workspace_id FROM artifact_pages a JOIN conversations c ON c.id = a.conversation_id
     WHERE a.id = $1`,
    [artifactId],
  );
  return rows[0]?.workspace_id ?? null;
}

export async function listArtifactPages(
  db: Queryable,
  conversationId: string,
): Promise<ArtifactPage[]> {
  const { rows } = await db.query<{
    id: string;
    kind: ArtifactPageKind;
    version: number;
    title: string;
    bytes: number;
    run_id: string | null;
    created_at: Date;
  }>(
    `SELECT a.id, a.kind, v.version, v.title, v.bytes,
            COALESCE(r.parent_run_id, v.run_id) AS run_id, v.created_at
     FROM artifact_pages a
     JOIN artifact_page_versions v ON v.artifact_id = a.id AND v.published_at IS NOT NULL
     LEFT JOIN runs r ON r.id = v.run_id
     WHERE a.conversation_id = $1
     ORDER BY a.created_at, a.id, v.version`,
    [conversationId],
  );
  const pages = new Map<string, ArtifactPage>();
  for (const row of rows) {
    const page = pages.get(row.id) ?? {
      id: row.id,
      title: row.title,
      kind: row.kind,
      versions: [],
    };
    page.title = row.title;
    page.versions.push({
      version: row.version,
      title: row.title,
      bytes: row.bytes,
      runId: row.run_id,
      createdAt: row.created_at.toISOString(),
    });
    pages.set(row.id, page);
  }
  return [...pages.values()];
}
