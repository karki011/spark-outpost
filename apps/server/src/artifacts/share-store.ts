import type { ArtifactShare } from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';

interface ShareRow {
  share_id: string;
  version: number;
  url: string;
  expires_at: Date;
  has_passcode: boolean;
  created_at: Date;
}

export interface PendingShare {
  shareId: string;
  artifactId: string;
  version: number;
  url: string;
  expiresAt: Date;
  hasPasscode: boolean;
}

export interface HeldShare {
  shareId: string;
  live: boolean;
  stale: boolean;
}

const COLUMNS = 'share_id, version, url, expires_at, has_passcode, created_at';
const PENDING_STALE_AFTER = "interval '1 minute'";

function toShare(row: ShareRow): ArtifactShare {
  return {
    shareId: row.share_id,
    version: row.version,
    url: row.url,
    expiresAt: row.expires_at.toISOString(),
    hasPasscode: row.has_passcode,
    createdAt: row.created_at.toISOString(),
  };
}

export async function liveShare(
  db: Queryable,
  artifactId: string,
  version: number,
): Promise<ArtifactShare | null> {
  const { rows } = await db.query<ShareRow>(
    `SELECT ${COLUMNS} FROM artifact_page_shares
     WHERE artifact_id = $1 AND version = $2 AND state = 'live' AND expires_at > now()`,
    [artifactId, version],
  );
  return rows[0] ? toShare(rows[0]) : null;
}

export async function heldShare(
  db: Queryable,
  artifactId: string,
  version: number,
): Promise<HeldShare | null> {
  const { rows } = await db.query<{ share_id: string; live: boolean; stale: boolean }>(
    `SELECT share_id, state = 'live' AS live,
            created_at < now() - ${PENDING_STALE_AFTER} AS stale
     FROM artifact_page_shares WHERE artifact_id = $1 AND version = $2`,
    [artifactId, version],
  );
  const row = rows[0];
  return row ? { shareId: row.share_id, live: row.live, stale: row.stale } : null;
}

export async function removeExpiredShare(
  db: Queryable,
  artifactId: string,
  version: number,
): Promise<string | null> {
  const { rows } = await db.query<{ share_id: string }>(
    `DELETE FROM artifact_page_shares
     WHERE artifact_id = $1 AND version = $2 AND expires_at <= now()
     RETURNING share_id`,
    [artifactId, version],
  );
  return rows[0]?.share_id ?? null;
}

export async function insertPendingShare(db: Queryable, share: PendingShare): Promise<boolean> {
  const { rowCount } = await db.query(
    `INSERT INTO artifact_page_shares
       (share_id, artifact_id, version, state, url, expires_at, has_passcode)
     VALUES ($1, $2, $3, 'pending', $4, $5, $6)
     ON CONFLICT DO NOTHING`,
    [share.shareId, share.artifactId, share.version, share.url, share.expiresAt, share.hasPasscode],
  );
  return rowCount === 1;
}

export async function markShareLive(
  db: Queryable,
  shareId: string,
  expiresAt: Date,
): Promise<ArtifactShare | null> {
  const { rows } = await db.query<ShareRow>(
    `UPDATE artifact_page_shares SET state = 'live', expires_at = $2
     WHERE share_id = $1 AND state = 'pending'
     RETURNING ${COLUMNS}`,
    [shareId, expiresAt],
  );
  return rows[0] ? toShare(rows[0]) : null;
}

export async function deleteShare(db: Queryable, shareId: string): Promise<void> {
  await db.query('DELETE FROM artifact_page_shares WHERE share_id = $1', [shareId]);
}

export async function expiredShareIds(db: Queryable): Promise<string[]> {
  const { rows } = await db.query<{ share_id: string }>(
    'SELECT share_id FROM artifact_page_shares WHERE expires_at <= now() ORDER BY created_at',
  );
  return rows.map((row) => row.share_id);
}

export async function orphanShareIds(db: Queryable): Promise<string[]> {
  const { rows } = await db.query<{ share_id: string }>(
    `SELECT s.share_id FROM artifact_page_shares s
     WHERE s.state = 'live' AND NOT EXISTS (
       SELECT 1 FROM artifact_page_versions v
       WHERE v.artifact_id = s.artifact_id AND v.version = s.version
     ) AND s.expires_at > now()
     ORDER BY s.created_at`,
  );
  return rows.map((row) => row.share_id);
}

export async function stalePendingShareIds(db: Queryable): Promise<string[]> {
  const { rows } = await db.query<{ share_id: string }>(
    `SELECT share_id FROM artifact_page_shares
     WHERE state = 'pending' AND created_at < now() - ${PENDING_STALE_AFTER}
       AND expires_at > now()
     ORDER BY created_at`,
  );
  return rows.map((row) => row.share_id);
}
