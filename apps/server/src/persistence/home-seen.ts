import type { HomeSeen } from '@spark-outpost/contracts';
import type { Queryable } from './db.ts';

interface SeenRow {
  home_seen_at: Date | null;
}

function toSeen(row: SeenRow | undefined): HomeSeen {
  return { seenAt: row?.home_seen_at?.toISOString() ?? null };
}

export async function homeSeen(db: Queryable, workspaceId: string): Promise<HomeSeen> {
  const { rows } = await db.query<SeenRow>(
    'SELECT home_seen_at FROM profiles WHERE workspace_id = $1',
    [workspaceId],
  );
  return toSeen(rows[0]);
}

export async function markHomeSeen(db: Queryable, workspaceId: string): Promise<HomeSeen> {
  const { rows } = await db.query<SeenRow>(
    `UPDATE profiles
     SET home_seen_at = GREATEST(COALESCE(home_seen_at, '-infinity'::timestamptz), now())
     WHERE workspace_id = $1
     RETURNING home_seen_at`,
    [workspaceId],
  );
  return toSeen(rows[0]);
}
